import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../src/utils/config.js";

const tempRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-utils-config-"));
  tempRoots.push(root);
  mkdirSync(join(root, ".contextweave"), { recursive: true });
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("loadConfig", () => {
  it("returns defaults when config.json is missing", () => {
    const root = makeRoot();

    expect(loadConfig(root)).toEqual({
      version: 1,
      ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
      tokenBudget: 10000,
      defaultMode: "feature",
      stalenessDepth: 7,
      confidenceDecay: 0.9,
      gcThreshold: 0.5,
      passiveTtlDays: 7,
      embeddingModel: undefined,
      primaryDirs: [],
      archiveDirs: [],
    });
  });

  it("merges ignore-style config fields and sanitizes supported values", () => {
    const root = makeRoot();
    writeFileSync(
      join(root, ".contextweave", "config.json"),
      JSON.stringify({
        version: 3,
        ignore: ["src/generated", " dist ", "", 123],
        exclude: ["vendor", "src/generated"],
        excludePatterns: ["coverage", " ", null],
        tokenBudget: 70000,
        defaultMode: "debug",
        stalenessDepth: -2,
        confidenceDecay: 0.25,
        gcThreshold: 2,
        passiveTtlDays: 14,
        embeddingModel: " local:model ",
        primaryDirs: [" src/core ", "", 5],
        archiveDirs: [" legacy ", null],
      }),
      "utf8"
    );

    expect(loadConfig(root)).toEqual({
      version: 3,
      ignore: ["src/generated", "dist", "vendor", "coverage"],
      tokenBudget: 50000,
      defaultMode: "debug",
      stalenessDepth: 0,
      confidenceDecay: 0.25,
      gcThreshold: 1,
      passiveTtlDays: 14,
      embeddingModel: "local:model",
      primaryDirs: ["src/core"],
      archiveDirs: ["legacy"],
    });
  });

  it("falls back to defaults for invalid config values and parse failures", () => {
    const root = makeRoot();
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    writeFileSync(join(root, ".contextweave", "config.json"), "{not valid json", "utf8");
    expect(loadConfig(root).tokenBudget).toBe(10000);
    expect(stderr).toHaveBeenCalled();

    writeFileSync(
      join(root, ".contextweave", "config.json"),
      JSON.stringify({
        version: 0,
        ignore: "node_modules",
        tokenBudget: "oops",
        defaultMode: "invalid",
        stalenessDepth: NaN,
        confidenceDecay: -10,
        gcThreshold: "bad",
        passiveTtlDays: 0,
        embeddingModel: "   ",
        primaryDirs: "src",
        archiveDirs: {},
        maliciousKey: "ignored",
      }),
      "utf8"
    );

    const config = loadConfig(root);
    expect(config).toMatchObject({
      version: 1,
      ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
      tokenBudget: 10000,
      defaultMode: "feature",
      stalenessDepth: 7,
      confidenceDecay: 0,
      gcThreshold: 0.5,
      passiveTtlDays: 1,
      embeddingModel: undefined,
      primaryDirs: [],
      archiveDirs: [],
    });
    expect("maliciousKey" in (config as Record<string, unknown>)).toBe(false);
  });
});
