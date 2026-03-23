import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, ProjectConfig } from "../../src/utils/config.js";

describe("config validation security", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(testDir, ".contextweave"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("arbitrary key rejection", () => {
    it("rejects arbitrary keys from raw config spread", () => {
      const configWithArbitrary = {
        version: 1,
        tokenBudget: 10000,
        defaultMode: "feature",
        stalenessDepth: 7,
        confidenceDecay: 0.9,
        gcThreshold: 0.5,
        ignore: [],
        primaryDirs: [],
        archiveDirs: [],
        maliciousKey: "should not appear",
        __proto__: { pollute: true },
      };

      writeFileSync(
        join(testDir, ".contextweave", "config.json"),
        JSON.stringify(configWithArbitrary),
        "utf8"
      );

      const result = loadConfig(testDir);

      // Should not contain arbitrary keys
      expect("maliciousKey" in result).toBe(false);
      expect((result as Record<string, unknown>).maliciousKey).toBeUndefined();
      // Verify prototype pollution did not occur - Object.prototype should not have pollute property
      expect("pollute" in Object.prototype).toBe(false);
    });

    it("only includes defined ProjectConfig fields", () => {
      const configWithExtras = {
        version: 1,
        tokenBudget: 10000,
        defaultMode: "feature",
        stalenessDepth: 7,
        confidenceDecay: 0.9,
        gcThreshold: 0.5,
        ignore: [],
        primaryDirs: [],
        archiveDirs: [],
        embeddingModel: "test-model",
        extraField1: "value1",
        extraField2: 123,
      };

      writeFileSync(
        join(testDir, ".contextweave", "config.json"),
        JSON.stringify(configWithExtras),
        "utf8"
      );

      const result = loadConfig(testDir);
      const definedKeys = Object.keys(result).sort();

      // Only ProjectConfig fields should be present
      const expectedKeys = [
        "version",
        "ignore",
        "tokenBudget",
        "defaultMode",
        "stalenessDepth",
        "confidenceDecay",
        "gcThreshold",
        "embeddingModel",
        "primaryDirs",
        "archiveDirs",
      ].sort();

      expect(definedKeys).toEqual(expectedKeys);
    });
  });

  describe("numeric bounds validation", () => {
    describe("tokenBudget", () => {
      it("clamps tokenBudget to minimum 100", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 50, // below min
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.tokenBudget).toBe(100);
      });

      it("clamps tokenBudget to maximum 50000", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 100000, // above max
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.tokenBudget).toBe(50000);
      });

      it("accepts valid tokenBudget within bounds", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000, // valid
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.tokenBudget).toBe(10000);
      });
    });

    describe("confidenceDecay", () => {
      it("clamps confidenceDecay to minimum 0", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: -0.5, // below min
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.confidenceDecay).toBe(0);
      });

      it("clamps confidenceDecay to maximum 1", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 1.5, // above max
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.confidenceDecay).toBe(1);
      });

      it("accepts valid confidenceDecay within bounds", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9, // valid
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.confidenceDecay).toBe(0.9);
      });
    });

    describe("stalenessDepth", () => {
      it("clamps stalenessDepth to minimum 0", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: -5, // below min
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.stalenessDepth).toBe(0);
      });

      it("clamps stalenessDepth to maximum 10", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 20, // above max
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.stalenessDepth).toBe(10);
      });

      it("accepts valid stalenessDepth within bounds", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7, // valid
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.stalenessDepth).toBe(7);
      });
    });

    describe("gcThreshold", () => {
      it("clamps gcThreshold to minimum 0", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: -0.1, // below min
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.gcThreshold).toBe(0);
      });

      it("clamps gcThreshold to maximum 1", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: 1.5, // above max
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.gcThreshold).toBe(1);
      });

      it("accepts valid gcThreshold within bounds", () => {
        writeFileSync(
          join(testDir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: "feature",
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: 0.5, // valid
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(testDir);
        expect(result.gcThreshold).toBe(0.5);
      });
    });
  });

  describe("defaultMode validation", () => {
    it("uses default when invalid mode provided", () => {
      writeFileSync(
        join(testDir, ".contextweave", "config.json"),
        JSON.stringify({
          version: 1,
          tokenBudget: 10000,
          defaultMode: "invalid_mode",
          stalenessDepth: 7,
          confidenceDecay: 0.9,
          gcThreshold: 0.5,
          ignore: [],
          primaryDirs: [],
          archiveDirs: [],
        }),
        "utf8"
      );

      const result = loadConfig(testDir);
      // Should fall back to valid default
      expect(["debug", "refactor", "feature", "review"]).toContain(result.defaultMode);
    });

    it("accepts all valid default modes", () => {
      const validModes: ProjectConfig["defaultMode"][] = ["debug", "refactor", "feature", "review"];

      for (const mode of validModes) {
        const dir = join(tmpdir(), `config-test-mode-${mode}-${Date.now()}`);
        mkdirSync(join(dir, ".contextweave"), { recursive: true });

        writeFileSync(
          join(dir, ".contextweave", "config.json"),
          JSON.stringify({
            version: 1,
            tokenBudget: 10000,
            defaultMode: mode,
            stalenessDepth: 7,
            confidenceDecay: 0.9,
            gcThreshold: 0.5,
            ignore: [],
            primaryDirs: [],
            archiveDirs: [],
          }),
          "utf8"
        );

        const result = loadConfig(dir);
        expect(result.defaultMode).toBe(mode);

        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("version validation", () => {
    it("ensures version is a positive integer", () => {
      writeFileSync(
        join(testDir, ".contextweave", "config.json"),
        JSON.stringify({
          version: -1,
          tokenBudget: 10000,
          defaultMode: "feature",
          stalenessDepth: 7,
          confidenceDecay: 0.9,
          gcThreshold: 0.5,
          ignore: [],
          primaryDirs: [],
          archiveDirs: [],
        }),
        "utf8"
      );

      const result = loadConfig(testDir);
      expect(result.version).toBeGreaterThanOrEqual(1);
    });
  });
});
