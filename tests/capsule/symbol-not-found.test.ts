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

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

afterAll(() => {
  db.close();
});

describe("symbol not found signal", () => {
  it("nonexistent single identifier query triggers symbolNotFound in metadata", () => {
    const result = generateCapsule(db, {
      query: "xQzNonExistentSymbol99",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolNotFound).toBe(true);
  });

  it("nonexistent symbol query forces LOW confidence", () => {
    const result = generateCapsule(db, {
      query: "xQzNonExistentSymbol99",
      tokenBudget: 4000,
    });
    expect(result.metadata.quality.coverageConfidence).toBeLessThanOrEqual(0.44);
  });

  it("nonexistent symbol query prepends note to content", () => {
    const result = generateCapsule(db, {
      query: "xQzNonExistentSymbol99",
      tokenBudget: 4000,
    });
    expect(result.content).toContain("No symbol named 'xQzNonExistentSymbol99' found in the index");
    expect(result.content).toContain("Showing related symbols");
  });

  it("existing symbol query does NOT trigger symbolNotFound", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolNotFound).toBeFalsy();
  });

  it("existing symbol query does NOT prepend note to content", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
    });
    expect(result.content).not.toContain("No symbol named");
  });

  it("multi-word query does NOT trigger symbolNotFound (not a single identifier)", () => {
    const result = generateCapsule(db, {
      query: "generate capsule output",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolNotFound).toBeFalsy();
  });

  it("query with spaces does NOT trigger symbolNotFound", () => {
    const result = generateCapsule(db, {
      query: "user service validation",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolNotFound).toBeFalsy();
    expect(result.content).not.toContain("No symbol named");
  });

  it("symbolNotFound adds reason to quality reasons", () => {
    const result = generateCapsule(db, {
      query: "xQzNonExistentSymbol99",
      tokenBudget: 4000,
    });
    expect(result.metadata.quality.reasons).toContain("symbol not found in index");
  });
});
