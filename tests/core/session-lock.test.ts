import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireServerSessionLock, releaseServerSessionLock } from "../../src/mcp/session-lock.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("server session lock", () => {
  it("allows primary and secondary holders for the same project", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-lock-"));
    tempDirs.push(root);
    mkdirSync(join(root, ".contextweave"), { recursive: true });

    const primary = acquireServerSessionLock(root);
    const secondary = acquireServerSessionLock(root);
    const lockPath = join(root, ".contextweave", "mcp-server.lock");

    expect(primary.mode).toBe("primary");
    expect(secondary.mode).toBe("secondary");
    expect(existsSync(lockPath)).toBe(true);

    const payload = JSON.parse(readFileSync(lockPath, "utf-8")) as { pid?: unknown; mode?: unknown };
    expect(payload.pid).toBe(process.pid);
    expect(payload.mode).toBe("primary");

    releaseServerSessionLock(secondary);
    expect(existsSync(lockPath)).toBe(true);
    releaseServerSessionLock(primary);
    expect(existsSync(lockPath)).toBe(false);

    const reacquired = acquireServerSessionLock(root);
    expect(reacquired.mode).toBe("primary");
    releaseServerSessionLock(reacquired);
  });

  it("reclaims a stale primary lock", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-lock-"));
    tempDirs.push(root);
    const lockDir = join(root, ".contextweave");
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, "mcp-server.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: 999_999, mode: "primary", createdAt: Date.now() }));

    const lock = acquireServerSessionLock(root);
    expect(lock.mode).toBe("primary");
    releaseServerSessionLock(lock);
  });
});
