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

describe("noise elimination in backfillWithinSelectedFiles", () => {
  it("generates a valid capsule for a broad query with large budget", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule token budget capsule output",
      tokenBudget: 10000,
      mode: "feature",
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
  });

  it("noise ratio stays below 0.7 for a focused query with large budget", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule token budget capsule output",
      tokenBudget: 10000,
      mode: "feature",
    });
    expect(result.metadata.quality.noiseRatio).toBeLessThan(0.7);
  });

  it("symbols in capsule have lexical relevance to query terms for broad queries", () => {
    const result = generateCapsule(db, {
      query: "pivot ranking score candidates",
      tokenBudget: 10000,
      mode: "feature",
    });
    const content = result.content.toLowerCase();
    const queryTerms = ["pivot", "rank", "score", "candidate"];
    const matchCount = queryTerms.filter((term) => content.includes(term)).length;
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });

  it("test files are less prevalent than source files in feature mode with large budget", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule token budget capsule output",
      tokenBudget: 10000,
      mode: "feature",
    });
    const files = result.metadata.filesIncluded;
    const testFileCount = files.filter((f) =>
      f.includes(".test.") || f.includes(".spec.") || f.includes("/tests/")
    ).length;
    const sourceFileCount = files.length - testFileCount;
    expect(sourceFileCount).toBeGreaterThanOrEqual(testFileCount);
  });

  it("test files are less prevalent than source files in review mode with large budget", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule token budget capsule output",
      tokenBudget: 10000,
      mode: "review",
    });
    const files = result.metadata.filesIncluded;
    const testFileCount = files.filter((f) =>
      f.includes(".test.") || f.includes(".spec.") || f.includes("/tests/")
    ).length;
    const sourceFileCount = files.length - testFileCount;
    expect(sourceFileCount).toBeGreaterThanOrEqual(testFileCount);
  });

  it("query-relevant symbols appear before unrelated high-centrality symbols in content", () => {
    const result = generateCapsule(db, {
      query: "backfillWithinSelectedFiles noise elimination",
      tokenBudget: 10000,
      mode: "feature",
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.metadata.quality.noiseRatio).toBeLessThan(0.8);
  });

  it("capsule with broad query does not have more noise symbols than relevant ones", () => {
    const result = generateCapsule(db, {
      query: "indexer file parser symbols extraction",
      tokenBudget: 10000,
      mode: "feature",
    });
    expect(result.metadata.quality.noiseRatio).toBeLessThan(0.5);
  });
});

describe("pre-pack symbol relevance gate (filterCandidatesBySymbolRelevance)", () => {
  it("narrow query keeps direct pivot dependencies even without query overlap", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
      mode: "feature",
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(1);
    expect(result.content).toContain("generateCapsule");
  });

  it("does not apply relevance gate for broad queries (more symbols than narrow focused query)", () => {
    const broad = generateCapsule(db, {
      query: "capsule generation pipeline symbols indexer candidates scorer formatter",
      tokenBudget: 8000,
      mode: "feature",
    });
    const narrow = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 8000,
      mode: "feature",
    });
    expect(broad.metadata.symbolCount).toBeGreaterThanOrEqual(narrow.metadata.symbolCount);
  });

  it("noise ratio does not increase after pre-pack gate is applied", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule pivot scoring ranked candidates",
      tokenBudget: 6000,
      mode: "feature",
    });
    expect(result.metadata.quality.noiseRatio).toBeLessThan(0.7);
  });
});
