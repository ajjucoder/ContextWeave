import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { updateCentralityScores } from "../../src/core/graph.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterEach(() => {
  db.close();
});

describe("centrality updates", () => {
  it("applies updates atomically inside a transaction", () => {
    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const now = Date.now();

    const fileId = files.insert({
      path: "/tx.ts",
      hash: "h",
      lastIndexed: now,
      mtime: now,
      language: "typescript",
      symbolCount: 2,
      error: null,
    });

    const first = symbols.insert({
      fileId,
      name: "first",
      kind: "function",
      startLine: 1,
      endLine: 1,
      signature: "function first()",
      bodyHash: "first-h",
      fullSource: "function first() {}",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
    });

    const second = symbols.insert({
      fileId,
      name: "second",
      kind: "function",
      startLine: 2,
      endLine: 2,
      signature: "function second()",
      bodyHash: "second-h",
      fullSource: "function second() {}",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
    });

    edges.insert({
      sourceSymbolId: first,
      targetSymbolId: second,
      kind: "call",
      createdAt: now,
    });

    db.exec(`
      CREATE TRIGGER fail_second_centrality_update
      BEFORE UPDATE OF centrality ON symbols
      WHEN OLD.id = ${second}
      BEGIN
        SELECT RAISE(FAIL, 'forced-centrality-failure');
      END;
    `);

    expect(() => updateCentralityScores(db)).toThrow(/forced-centrality-failure/);

    const refreshedFirst = symbols.getById(first);
    const refreshedSecond = symbols.getById(second);
    expect(refreshedFirst?.centrality).toBe(0);
    expect(refreshedSecond?.centrality).toBe(0);
  });
});
