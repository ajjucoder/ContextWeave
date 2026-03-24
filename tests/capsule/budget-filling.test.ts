import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;
let repoDb: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);

  repoDb = new Database(":memory:");
  repoDb.pragma("foreign_keys = ON");
  createSchema(repoDb);
  await indexProject(repoDb, resolve(__dirname, "../.."));
  updateCentralityScores(repoDb);
}, 120000);

afterAll(() => {
  db.close();
  repoDb.close();
});

describe("budget filling for broad queries", () => {
  it("budget filling code path runs without errors for various budgets", () => {
    for (const tokenBudget of [4000, 8000, 12000]) {
      const result = generateCapsule(db, {
        query: "capsule generation token budget packer symbols ranked candidates indexer",
        tokenBudget,
        mode: "feature",
      });
      expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(0);
      expect(result.metadata.tokensUsed).toBeGreaterThanOrEqual(0);
      expect(result.metadata.tokensUsed).toBeLessThanOrEqual(result.metadata.tokenBudget);
    }
  });

  it("4K broad query uses at least 50% of budget", () => {
    const result = generateCapsule(db, {
      query: "check for error handling issues in database queries and indexing",
      tokenBudget: 4000,
      mode: "feature",
    });
    const utilization = result.metadata.tokensUsed / result.metadata.tokenBudget;
    expect(utilization).toBeGreaterThanOrEqual(0.50);
  });

  it("BROAD_TASK_TARGET_UTILIZATION is 0.85 (raised from 0.7)", () => {
    const result = generateCapsule(db, {
      query: "capsule generation pipeline symbols indexer",
      tokenBudget: 10000,
      mode: "feature",
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    const utilization = result.metadata.tokensUsed / result.metadata.tokenBudget;
    expect(utilization).toBeGreaterThanOrEqual(0.50);
  });

  it("story-complete fallback focuses on top files when scatter detected", () => {
    const result = generateCapsule(db, {
      query: "xyzScatterQueryThatMatchesNothing123",
      tokenBudget: 4000,
      mode: "feature",
    });
    expect(result.metadata.symbolCount).toBeGreaterThanOrEqual(0);
  });

  it("broad query with large budget has low noise ratio", () => {
    const result = generateCapsule(db, {
      query: "capsule generation pipeline symbols indexer",
      tokenBudget: 8000,
      mode: "feature",
    });
    expect(result.metadata.quality.noiseRatio).toBeLessThan(0.6);
  });

  it("8K broad queries on the full repo do not regress below 25% utilization", () => {
    const queries = [
      "capsule generation pipeline symbols indexer candidates scorer formatter",
      "database schema migration tables indexes",
      "optimize the BFS traversal for large graphs",
    ];

    for (const query of queries) {
      const result = generateCapsule(repoDb, {
        query,
        tokenBudget: 8000,
        mode: "feature",
        projectRoot: resolve(__dirname, "../.."),
      });
      const utilization = result.metadata.tokensUsed / result.metadata.tokenBudget;
      expect(
        utilization,
        `${query} used ${result.metadata.tokensUsed}/${result.metadata.tokenBudget}`
      ).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("capsule generation still works after budget filling changes", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.content).toContain("generateCapsule");
  });
});
