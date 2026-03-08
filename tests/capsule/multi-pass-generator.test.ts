import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;
const SRC_DIR = resolve(__dirname, "../../src");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, SRC_DIR);
  updateCentralityScores(db);
}, 60000);

afterAll(() => {
  db.close();
});

describe("multi-pass generator", () => {
  it("uses multi-pass mode for broad/task decomposition", () => {
    const broad = generateCapsule(db, {
      query: "capsule generation pipeline scoring compression",
      tokenBudget: 4500,
    });
    const task = generateCapsule(db, {
      query: "find bugs in the capsule pipeline",
      tokenBudget: 4500,
    });

    expect(broad.metadata.strategy?.intent).toBe("broad");
    expect(task.metadata.strategy?.intent).toBe("task");
    expect(task.metadata.strategy?.subQueryCount).toBeGreaterThanOrEqual(2);
    expect(task.content).toContain("Strategy:");
  });

  it("keeps broad queries efficient when compression can cover the story cheaply", () => {
    const broad = generateCapsule(db, {
      query: "database schema migration tables indexes",
      tokenBudget: 10000,
    });

    expect(broad.metadata.strategy?.intent).toBe("broad");
    expect(broad.metadata.quality.retrieval.stageBSelectedCount).toBeGreaterThan(0);
    expect(broad.metadata.symbolCount).toBeGreaterThanOrEqual(5);
    expect(broad.metadata.fileCount).toBeGreaterThanOrEqual(3);
    expect(broad.metadata.quality.coverageConfidence).toBeGreaterThan(0.7);
    expect(broad.metadata.tokensUsed).toBeLessThan(broad.metadata.tokenBudget * 0.15);
    expect(broad.metadata.tokensUsed).toBeGreaterThan(1000);
  });
});
