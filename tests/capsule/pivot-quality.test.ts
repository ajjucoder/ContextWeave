import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, FIXTURE_DIR);
  updateCentralityScores(db);
}, 30000);

afterAll(() => {
  db.close();
});

describe("pivot quality after multi-term scoring", () => {
  it("produces valid results for multi-term query", () => {
    const result = generateCapsule(db, {
      query: "user service validation",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
  });

  it("produces valid results for single-term query", () => {
    const result = generateCapsule(db, {
      query: "user",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
  });

  it("coverage confidence is higher than baseline 25%", () => {
    const result = generateCapsule(db, {
      query: "user service validation",
      tokenBudget: 4000,
    });
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.25);
  });

  it("returns symbols from relevant files for targeted query", () => {
    const result = generateCapsule(db, {
      query: "validateEmail",
      tokenBudget: 2000,
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.content).toContain("validateEmail");
  });
});
