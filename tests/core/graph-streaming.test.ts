import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { computePageRank } from "../../src/core/graph.js";

let db: Database.Database;

function seedGraph(rowCount: number): void {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();
  const fileId = files.insert({
    path: "/streaming.ts",
    hash: "h",
    lastIndexed: now,
    mtime: 0,
    language: "typescript",
    symbolCount: rowCount + 1,
    error: null,
  });

  const ids: number[] = [];
  for (let i = 0; i < rowCount + 1; i++) {
    ids.push(symbols.insert({
      fileId,
      name: `s${i}`,
      kind: "function",
      startLine: i + 1,
      endLine: i + 1,
      signature: `function s${i}()`,
      bodyHash: `h${i}`,
      fullSource: `function s${i}(){}`,
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
    }));
  }

  for (let i = 0; i < rowCount; i++) {
    edges.insert({
      sourceSymbolId: ids[i]!,
      targetSymbolId: ids[i + 1]!,
      kind: "call",
      createdAt: now,
    });
  }
}

describe("graph streaming edge access", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("provides iterable edge access for streaming graph computations", () => {
    const edges = edgeQueries(db) as ReturnType<typeof edgeQueries> & { iterateAll?: () => Iterable<unknown> };
    expect(typeof edges.iterateAll).toBe("function");
  });

  it("computes pagerank on a large graph without materialization-only APIs", () => {
    seedGraph(2000);
    const ranks = computePageRank(db);
    expect(ranks.size).toBe(2001);
  });
});
