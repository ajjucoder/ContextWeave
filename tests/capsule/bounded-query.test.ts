import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

describe("bounded query time", () => {
  it("generateCapsule accepts maxQueryTimeMs param without error", () => {
    expect(() => {
      generateCapsule(db, { query: "generateCapsule", tokenBudget: 4000, maxQueryTimeMs: 500 });
    }).not.toThrow();
  });

  it("generateCapsule always returns a result even with very low time budget", () => {
    const result = generateCapsule(db, {
      query: "weightedBfsTraversal",
      tokenBudget: 4000,
      maxQueryTimeMs: 1,
    });
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it("generateCapsule with normal budget completes with good confidence", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
      maxQueryTimeMs: 500,
    });
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.30);
  });

  it("timeLimited flag is set when BFS or promotion is skipped", () => {
    const result = generateCapsule(db, {
      query: "weightedBfsTraversal",
      tokenBudget: 4000,
      maxQueryTimeMs: 1,
    });
    expect(result.metadata.timeLimited).toBe(true);
  });

  it("timeLimited flag is absent on normal execution", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
      maxQueryTimeMs: 500,
    });
    expect(result.metadata.timeLimited).toBeUndefined();
  });
});
