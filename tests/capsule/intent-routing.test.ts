import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, FIXTURE_DIR);
  updateCentralityScores(db);
});

afterAll(() => {
  db.close();
});

describe("intent routing", () => {
  it("routes narrow queries to single-pass strategy", () => {
    const result = generateCapsule(db, {
      query: "UserService",
      tokenBudget: 2500,
    });

    expect(result.metadata.strategy?.intent).toBe("narrow");
    expect(result.metadata.strategy?.mode).toBe("single-pass");
  });

  it("routes broad/task queries through intent-aware strategy metadata", () => {
    const broad = generateCapsule(db, {
      query: "capsule generation pipeline scoring compression",
      tokenBudget: 3500,
    });
    const task = generateCapsule(db, {
      query: "find bugs in the capsule pipeline",
      tokenBudget: 3500,
    });

    expect(broad.metadata.strategy?.intent).toBe("broad");
    expect(task.metadata.strategy?.intent).toBe("task");
    expect(broad.metadata.strategy?.subQueryCount).toBeGreaterThanOrEqual(1);
    expect(task.metadata.strategy?.subQueryCount).toBeGreaterThanOrEqual(2);
  });
});
