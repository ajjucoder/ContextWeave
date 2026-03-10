import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
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
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

describe("session-aware pivot boosting", () => {
  it("second query with sessionId has confidence >= first query", () => {
    const sessionId = "boost-test-session-1";

    const first = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
      sessionId,
    });

    const second = generateCapsule(db, {
      query: "packNodes formatCapsule",
      tokenBudget: 4000,
      sessionId,
    });

    expect(first.metadata.quality.coverageConfidence).toBeGreaterThan(0.5);
    expect(second.metadata.quality.coverageConfidence).toBeGreaterThan(0.5);
  });

  it("generateCapsule accepts optional sessionId param without error", () => {
    expect(() => {
      generateCapsule(db, { query: "weightedBfsTraversal", tokenBudget: 2000, sessionId: "test-session" });
    }).not.toThrow();

    expect(() => {
      generateCapsule(db, { query: "weightedBfsTraversal", tokenBudget: 2000 });
    }).not.toThrow();
  });

  it("does not let implicit default-session history pollute a later narrow symbol query", () => {
    generateCapsule(db, { query: "generateCapsule", tokenBudget: 4000 });
    generateCapsule(db, { query: "weightedBfsTraversal", tokenBudget: 4000 });
    generateCapsule(db, { query: "scorePivotRelevance", tokenBudget: 4000 });

    const result = generateCapsule(db, {
      query: "SessionContext",
      tokenBudget: 4000,
    });

    expect(result.metadata.fileCount).toBeGreaterThanOrEqual(1);
    expect(result.metadata.fileCount).toBeLessThanOrEqual(3);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.3);
    expect(result.content).toContain("SessionContext");
  });
});
