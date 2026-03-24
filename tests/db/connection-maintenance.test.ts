import { afterEach, describe, expect, it, vi } from "vitest";
import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, getDb } from "../../src/db/connection.js";

const tempRoots: string[] = [];
const originalMaxSize = process.env["CONTEXTWEAVE_MAX_DB_BYTES"];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeDb();
  if (originalMaxSize === undefined) {
    delete process.env["CONTEXTWEAVE_MAX_DB_BYTES"];
  } else {
    process.env["CONTEXTWEAVE_MAX_DB_BYTES"] = originalMaxSize;
  }

  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("DB connection maintenance", () => {
  it("rejects databases larger than configured size limit", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-db-limit-"));
    tempRoots.push(root);
    const dbPath = join(root, "oversized.db");

    writeFileSync(dbPath, Buffer.alloc(2048, 1));
    process.env["CONTEXTWEAVE_MAX_DB_BYTES"] = "1024";

    expect(() => getDb(dbPath)).toThrow(/exceeds max size limit/);
  });

  it("configures incremental auto_vacuum on open", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-db-vacuum-"));
    tempRoots.push(root);
    const dbPath = join(root, "normal.db");

    const db = getDb(dbPath);
    const autoVacuum = db.pragma("auto_vacuum", { simple: true }) as number;
    expect(autoVacuum).toBe(2);
  });

  it("schedules incremental maintenance every 30 minutes when enabled", () => {
    vi.useFakeTimers();

    const root = mkdtempSync(join(tmpdir(), "cw-db-schedule-"));
    tempRoots.push(root);
    const dbPath = join(root, "scheduled.db");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    getDb(dbPath, { scheduleMaintenance: true });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
  });

  it("prevents overlapping scheduled maintenance runs", () => {
    vi.useFakeTimers();

    const root = mkdtempSync(join(tmpdir(), "cw-db-guard-"));
    tempRoots.push(root);
    const dbPath = join(root, "guarded.db");
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const db = getDb(dbPath);

    getDb(dbPath, { scheduleMaintenance: true });

    const scheduledRun = setIntervalSpy.mock.calls[0]?.[0];
    expect(typeof scheduledRun).toBe("function");
    const fd = openSync(dbPath, "r+");
    ftruncateSync(fd, 512 * 1024 * 1024);
    closeSync(fd);

    let reentered = false;
    const execSpy = vi.spyOn(db, "exec").mockImplementation((sql: string) => {
      if (sql === "PRAGMA incremental_vacuum(2000)" && !reentered) {
        reentered = true;
        (scheduledRun as () => void)();
      }
      return db;
    });

    (scheduledRun as () => void)();

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledWith("PRAGMA incremental_vacuum(2000)");
  });
});
