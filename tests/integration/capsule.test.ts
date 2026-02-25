import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const fixtureDir = resolve(__dirname, "../fixtures");
  await indexProject(db, fixtureDir);
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

  it("includes metadata with correct fields", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
    });

    expect(result.metadata.query).toBe("validateEmail");
    expect(result.metadata.mode).toBe("feature");
    expect(result.metadata.tokenBudget).toBeDefined();
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.fileCount).toBeGreaterThanOrEqual(0);
    expect(result.metadata.generatedAt).toBeGreaterThan(0);
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
  });
});
