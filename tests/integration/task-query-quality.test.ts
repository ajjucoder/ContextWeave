import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NARROW_QUERIES,
  BROAD_QUERIES,
  TASK_QUERIES,
  NARROW_THRESHOLD,
  BROAD_THRESHOLD,
  TASK_THRESHOLD,
  OVERALL_THRESHOLD,
  NARROW_TOKEN_BUDGET,
  BROAD_TOKEN_BUDGET,
  TASK_TOKEN_BUDGET,
} from "./task-query-fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;
const confidenceByQuery = new Map<string, number>();

function evaluateQuery(query: string, tokenBudget: number): number {
  const cacheKey = `${tokenBudget}:${query}`;
  const cached = confidenceByQuery.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = generateCapsule(db, { query, tokenBudget });
  confidenceByQuery.set(cacheKey, result.metadata.quality.coverageConfidence);
  return result.metadata.quality.coverageConfidence;
}

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

afterAll(() => db?.close());

describe("query quality by class", () => {
  describe("CLASS A: narrow symbol queries", () => {
    for (const query of NARROW_QUERIES) {
      it(`"${query}" confidence > ${NARROW_THRESHOLD * 100}%`, () => {
        const confidence = evaluateQuery(query, NARROW_TOKEN_BUDGET);
        expect(confidence).toBeGreaterThan(NARROW_THRESHOLD);
      });
    }
  });

  describe("CLASS B: broad architectural queries", () => {
    for (const query of BROAD_QUERIES) {
      it(`"${query}" confidence > ${BROAD_THRESHOLD * 100}%`, () => {
        const confidence = evaluateQuery(query, BROAD_TOKEN_BUDGET);
        expect(confidence).toBeGreaterThan(BROAD_THRESHOLD);
      });
    }
  });

  describe("CLASS C: task-oriented queries", () => {
    for (const query of TASK_QUERIES) {
      it(`"${query}" confidence > ${TASK_THRESHOLD * 100}%`, () => {
        const confidence = evaluateQuery(query, TASK_TOKEN_BUDGET);
        expect(confidence).toBeGreaterThan(TASK_THRESHOLD);
      });
    }
  });

  it("overall average confidence > threshold (per-class budgets)", () => {
    let total = 0;
    let count = 0;
    for (const query of NARROW_QUERIES) {
      total += evaluateQuery(query, NARROW_TOKEN_BUDGET);
      count++;
    }
    for (const query of BROAD_QUERIES) {
      total += evaluateQuery(query, BROAD_TOKEN_BUDGET);
      count++;
    }
    for (const query of TASK_QUERIES) {
      total += evaluateQuery(query, TASK_TOKEN_BUDGET);
      count++;
    }
    expect(total / count).toBeGreaterThan(OVERALL_THRESHOLD);
  });
});
