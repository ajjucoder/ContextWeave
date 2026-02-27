import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/cli/commands/init.js";
import { getExistingDb } from "../../src/db/connection.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("runInit DB lifecycle", () => {
  it("closes DB connection before returning", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-init-close-"));
    tempRoots.push(root);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "main.ts"), "export const main = 1;\n");

    await runInit(root);

    const dbPath = resolve(root, ".contextweave", "contextweave.db");
    expect(getExistingDb(dbPath)).toBeNull();
  });
});
