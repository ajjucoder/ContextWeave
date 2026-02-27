import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, getDb } from "../../src/db/connection.js";

const tempRoots: string[] = [];
const originalMaxSize = process.env["CONTEXTWEAVE_MAX_DB_BYTES"];

afterEach(() => {
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
});
