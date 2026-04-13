import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isIgnoredForIndexing } from "../../src/core/indexer.js";

function waitForMtimeTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
}

describe("ignore file cache", () => {
  it("refreshes cached .cwignore rules after the file changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "cw-ignore-cache-"));
    const filePath = join(root, "src", "generated.ts");

    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(filePath, "export const generated = true;\n");
    writeFileSync(join(root, ".cwignore"), "");

    try {
      expect(isIgnoredForIndexing(filePath, root)).toBe(false);

      await waitForMtimeTick();
      writeFileSync(join(root, ".cwignore"), "src/generated.ts\n");
      expect(isIgnoredForIndexing(filePath, root)).toBe(true);

      await waitForMtimeTick();
      writeFileSync(join(root, ".cwignore"), "");
      expect(isIgnoredForIndexing(filePath, root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
