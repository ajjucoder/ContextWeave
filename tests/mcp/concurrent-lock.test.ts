import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireServerSessionLock, releaseServerSessionLock } from "../../src/mcp/session-lock.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("non-blocking server lock", () => {
  it("keeps the primary lock payload stable while secondaries attach and detach", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-lock-mcp-"));
    tempDirs.push(root);
    mkdirSync(join(root, ".contextweave"), { recursive: true });
    const lockPath = join(root, ".contextweave", "mcp-server.lock");

    const primary = acquireServerSessionLock(root);
    expect(primary.mode).toBe("primary");

    const baseline = readFileSync(lockPath, "utf-8");
    const secondaryA = acquireServerSessionLock(root);
    const secondaryB = acquireServerSessionLock(root);
    expect(secondaryA.mode).toBe("secondary");
    expect(secondaryB.mode).toBe("secondary");

    releaseServerSessionLock(secondaryA);
    releaseServerSessionLock(secondaryB);

    expect(readFileSync(lockPath, "utf-8")).toBe(baseline);
    releaseServerSessionLock(primary);
  });
});
