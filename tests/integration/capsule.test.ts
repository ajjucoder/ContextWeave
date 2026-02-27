import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  await indexProject(db, FIXTURE_DIR);
  updateCentralityScores(db);
});

afterAll(() => {
  db.close();
});

describe("generateCapsule", () => {
  it("generates a capsule for a valid query", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 4000,
      mode: "feature",
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content).toContain("ContextWeave Capsule");
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeLessThanOrEqual(4000);
  });

  it("renders relative paths in capsule output", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 2000,
      mode: "feature",
    });

    expect(result.content).toContain("sample.ts");
    expect(result.content).not.toContain(FIXTURE_DIR);
    expect(result.content).not.toMatch(/\/\/\s+(?:[A-Za-z]:[\\/]|\/)/);
    expect(result.content).not.toMatch(/\/\/\s+===\s+(?:[A-Za-z]:[\\/]|\/)/);
    expect(result.content).not.toMatch(/\((?:[A-Za-z]:[\\/]|\/)[^):]+:\d+\)/);
  });

  it("respects token budget", () => {
    const smallResult = generateCapsule(db, {
      query: "User",
      tokenBudget: 500,
    });

    const largeResult = generateCapsule(db, {
      query: "User",
      tokenBudget: 4000,
    });

    expect(smallResult.metadata.tokensUsed).toBeLessThanOrEqual(500);
    expect(largeResult.metadata.tokensUsed).toBeLessThanOrEqual(4000);
  });

  it("uses full code budget when observations are minimal", () => {
    const result = generateCapsule(db, {
      query: "User",
      tokenBudget: 500,
    });

    expect(result.metadata.observationCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(350);
  });

  it("includes metadata with correct fields", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
    });

    expect(result.metadata.query).toBe("validateEmail");
    expect(result.metadata.mode).toBe("feature");
    expect(result.metadata.tokenBudget).toBeDefined();
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.fileCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.pivotCoverage).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.pivotCoverage).toBeLessThanOrEqual(1);
    expect(result.metadata.quality.dependencyCoverage).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.dependencyCoverage).toBeLessThanOrEqual(1);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.coverageConfidence).toBeLessThanOrEqual(1);
    expect(typeof result.metadata.quality.uncertaintyFlag).toBe("boolean");
    expect(typeof result.metadata.quality.lowConfidence).toBe("boolean");
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.metadata.quality.reasons)).toBe(true);
    expect(result.metadata.diagnostics).toBeDefined();
    expect(result.metadata.generatedAt).toBeGreaterThan(0);
  });

  it("runs stage A retrieval before stage B filtering", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
      tokenBudget: 2000,
    });

    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThanOrEqual(
      result.metadata.quality.retrieval.stageBSelectedCount
    );
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThan(0);
  });

  it("includes uncertainty flag and coverage confidence in formatted output", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 2000,
    });

    expect(result.content).toContain("Coverage confidence:");
    expect(result.content).toContain("Uncertainty flag:");
    expect(result.content).toContain("Retrieval: stageA");
  });

  it("supports different modes", () => {
    const debugResult = generateCapsule(db, {
      query: "User",
      mode: "debug",
    });

    const reviewResult = generateCapsule(db, {
      query: "User",
      mode: "review",
    });

    expect(debugResult.content.length).toBeGreaterThan(0);
    expect(reviewResult.content.length).toBeGreaterThan(0);
  });

  it("handles queries with no matches gracefully", () => {
    const result = generateCapsule(db, {
      query: "nonexistentSymbolXYZ123",
      tokenBudget: 2000,
    });

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.metadata.symbolCount).toBe(0);
    expect(result.content).toContain("--- Diagnostics ---");
  });
});
