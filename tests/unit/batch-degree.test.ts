import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { getSymbolDegree, getBatchSymbolDegrees } from "../../src/core/graph.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

let db: Database.Database;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, FIXTURE_DIR);
});

afterAll(() => {
  db.close();
});

describe("batch symbol degree", () => {
  it("returns the same results as individual getSymbolDegree calls", () => {
    const symbols = symbolQueries(db);
    const allIds = symbols.getAllIds();
    const testIds = allIds.slice(0, Math.min(20, allIds.length));

    const batchResult = getBatchSymbolDegrees(db, testIds);

    for (const id of testIds) {
      const individual = getSymbolDegree(db, id);
      const batch = batchResult.get(id) ?? 0;
      expect(batch).toBe(individual);
    }
  });

  it("handles empty input", () => {
    const result = getBatchSymbolDegrees(db, []);
    expect(result.size).toBe(0);
  });

  it("returns 0 for symbols with no edges", () => {
    const result = getBatchSymbolDegrees(db, [999999]);
    expect(result.get(999999)).toBe(0);
  });
});
