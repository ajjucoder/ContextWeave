import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDirectoryWeight } from "../../src/utils/directory-weights.js";

const tempRoots: string[] = [];

function makeRoot(config?: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "cw-utils-weight-"));
  tempRoots.push(root);
  if (config) {
    mkdirSync(join(root, ".contextweave"), { recursive: true });
    writeFileSync(join(root, ".contextweave", "config.json"), JSON.stringify(config), "utf8");
  }
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("getDirectoryWeight", () => {
  it("downweights known archive, docs, test, and build paths", () => {
    expect(getDirectoryWeight("legacy/service/index.ts")).toBe(0.15);
    expect(getDirectoryWeight("docs/reference/api.md")).toBe(0.4);
    expect(getDirectoryWeight("tests/unit/example.test.ts")).toBe(0.6);
    expect(getDirectoryWeight("public/app.js")).toBe(0.3);
    expect(getDirectoryWeight("dist/server/index.js")).toBe(0.1);
  });

  it("upweights prioritized source roots and preserves neutral paths", () => {
    expect(getDirectoryWeight("src/app/page.tsx")).toBe(1.15);
    expect(getDirectoryWeight("src/core/indexer.ts")).toBe(1.15);
    expect(getDirectoryWeight("packages/sdk/index.ts")).toBe(1.15);
    expect(getDirectoryWeight("src/components/button.tsx")).toBe(1);
    expect(getDirectoryWeight("README.md")).toBe(1);
  });

  it("applies config primary and archive overrides after path normalization", () => {
    const root = makeRoot({
      primaryDirs: ["Apps/API", "custom\\services"],
      archiveDirs: ["Attic", "old\\snapshots"],
    });

    expect(getDirectoryWeight("./apps/api/routes/users.ts", root)).toBe(1.15);
    expect(getDirectoryWeight("custom/services/job.ts", root)).toBe(1.15);
    expect(getDirectoryWeight("/attic/notes.txt", root)).toBe(0.1);
    expect(getDirectoryWeight("old/snapshots/report.ts", root)).toBe(0.1);
  });
});
