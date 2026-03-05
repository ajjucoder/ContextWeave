import { describe, it, expect } from "vitest";
import { resolveAliasedImport, loadTsconfigPaths, type TsconfigPaths } from "../../src/utils/tsconfig-paths.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveAliasedImport", () => {
  const paths: TsconfigPaths = {
    baseUrl: "/project/src",
    aliases: [
      { prefix: "@/", paths: ["/project/src/"] },
      { prefix: "~utils/", paths: ["/project/src/utils/", "/project/lib/utils/"] },
    ],
  };

  it("resolves aliased import with single path", () => {
    const result = resolveAliasedImport("@/core/indexer", paths);
    expect(result).toEqual(["/project/src/core/indexer"]);
  });

  it("resolves aliased import with multiple paths", () => {
    const result = resolveAliasedImport("~utils/logger", paths);
    expect(result).toEqual(["/project/src/utils/logger", "/project/lib/utils/logger"]);
  });

  it("falls back to baseUrl for bare imports", () => {
    const result = resolveAliasedImport("shared/types", paths);
    expect(result).toEqual(["/project/src/shared/types"]);
  });

  it("returns empty for relative imports", () => {
    expect(resolveAliasedImport("./local", paths)).toEqual([]);
    expect(resolveAliasedImport("../parent", paths)).toEqual([]);
  });

  it("returns empty for absolute paths", () => {
    expect(resolveAliasedImport("/absolute/path", paths)).toEqual([]);
  });
});

describe("loadTsconfigPaths", () => {
  it("returns null when no tsconfig exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-test-"));
    try {
      const result = loadTsconfigPaths(dir);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads paths from tsconfig.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-test-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["./src/*"],
            },
          },
        })
      );

      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.aliases).toHaveLength(1);
      expect(result!.aliases[0]!.prefix).toBe("@/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles tsconfig with comments", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-test-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        `{
          // base config
          "compilerOptions": {
            "baseUrl": "src",
            /* path aliases */
            "paths": {
              "@/*": ["./core/*"]
            }
          }
        }`
      );

      const result = loadTsconfigPaths(dir);
      expect(result).not.toBeNull();
      expect(result!.aliases).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips patterns without wildcard suffix", () => {
    const dir = mkdtempSync(join(tmpdir(), "cw-test-"));
    try {
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            paths: {
              "exact-match": ["./src/exact"],
              "@/*": ["./src/*"],
            },
          },
        })
      );

      const result = loadTsconfigPaths(dir);
      expect(result!.aliases).toHaveLength(1);
      expect(result!.aliases[0]!.prefix).toBe("@/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
