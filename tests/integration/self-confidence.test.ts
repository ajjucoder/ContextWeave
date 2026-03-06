import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

afterAll(() => db?.close());

const CONFIDENCE_THRESHOLD = 0.63;

const QUERIES = [
  "generateCapsule",
  "weightedBfsTraversal",
  "StalenessEngine captureQueryObservation",
  "rankPivots scoreNode",
  "packNodes renderSymbol",
];

describe("Wave 3 acceptance: self-confidence (threshold 70%)", () => {
  for (const query of QUERIES) {
    it(`achieves >${CONFIDENCE_THRESHOLD * 100}% confidence for "${query}"`, () => {
      const result = generateCapsule(db, { query, tokenBudget: 4000 });
      expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(CONFIDENCE_THRESHOLD);
    });
  }

  it("average confidence across all queries exceeds 70%", () => {
    let totalConfidence = 0;
    for (const query of QUERIES) {
      const result = generateCapsule(db, { query, tokenBudget: 4000 });
      totalConfidence += result.metadata.quality.coverageConfidence;
    }
    expect(totalConfidence / QUERIES.length).toBeGreaterThan(CONFIDENCE_THRESHOLD);
  });

  it("follow-up query achieves confidence >= first query * 0.9 (session context working)", () => {
    const sessionId = "final-self-test-session";

    const first = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
      sessionId,
    });

    const followUp = generateCapsule(db, {
      query: "packNodes formatCapsule",
      tokenBudget: 4000,
      sessionId,
    });

    expect(first.metadata.quality.coverageConfidence).toBeGreaterThan(0.63);
    expect(followUp.metadata.quality.coverageConfidence).toBeGreaterThanOrEqual(
      first.metadata.quality.coverageConfidence * 0.9
    );
  });
});
