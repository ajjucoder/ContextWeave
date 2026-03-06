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

describe("two-phase retrieval", () => {
  it("capsule generation still works after two-phase retrieval change", () => {
    const result = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
    });
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.55);
  });

  it("pivot scoring still works with file pre-filter", () => {
    const result = generateCapsule(db, {
      query: "weightedBfsTraversal",
      tokenBudget: 2000,
    });
    expect(result.content).toContain("weightedBfsTraversal");
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.55);
  });

  it("generates valid capsule when file_summaries table is empty (fallback)", () => {
    const emptyDb = new Database(":memory:");
    emptyDb.pragma("foreign_keys = ON");
    createSchema(emptyDb);
    const result = generateCapsule(emptyDb, {
      query: "anything",
      tokenBudget: 2000,
    });
    expect(result).toBeDefined();
    emptyDb.close();
  });

  it("bounds stage A and stage B candidate breadth for broad/task retrieval", () => {
    const result = generateCapsule(db, {
      query: "check for error handling issues in database queries",
      tokenBudget: 10000,
    });

    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThan(0);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBeGreaterThan(0);
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeLessThanOrEqual(200);
    expect(result.metadata.quality.retrieval.stageBSelectedCount).toBeLessThanOrEqual(260);
  });
});
