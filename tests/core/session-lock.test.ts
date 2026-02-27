import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  it("prevents multiple concurrent holders for the same project", () => {
    const root = mkdtempSync(join(tmpdir(), "cw-lock-"));
    tempDirs.push(root);
    mkdirSync(join(root, ".contextweave"), { recursive: true });

    const lock = acquireServerSessionLock(root);

    expect(() => acquireServerSessionLock(root)).toThrow(/lock already held/i);

    releaseServerSessionLock(lock);
    const reacquired = acquireServerSessionLock(root);
    releaseServerSessionLock(reacquired);
  });
});
