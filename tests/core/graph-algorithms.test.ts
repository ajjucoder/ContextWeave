import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { computeBetweennessCentrality, updateCentralityScores } from "../../src/core/graph.js";

let db: Database.Database;

function insertGraph(edgeList: Array<[string, string]>) {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();
  const fileId = files.insert({
    path: "src/graph.ts",
    hash: "graph-hash",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 0,
    error: null,
  });

  const ids = new Map<string, number>();
  const names = [...new Set(edgeList.flatMap(([source, target]) => [source, target]))];
  for (const name of names) {
    const id = symbols.insert({
      fileId,
      name,
      kind: "function",
      startLine: 1,
      endLine: 1,
      signature: `function ${name}()`,
      bodyHash: `${name}-hash`,
      fullSource: `function ${name}() {}`,
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: now,
      parentSymbolId: null,
      qualifiedName: null,
    });
    ids.set(name, id);
  }

  for (const [source, target] of edgeList) {
    edges.insert({
      sourceSymbolId: ids.get(source)!,
      targetSymbolId: ids.get(target)!,
      kind: "call",
      createdAt: now,
    });
  }

  return ids;
}

describe("graph algorithms", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("computes Brandes betweenness centrality for a 3-node line graph", () => {
    const ids = insertGraph([
      ["A", "B"],
      ["B", "C"],
    ]);

    const betweenness = computeBetweennessCentrality(db);

    expect(betweenness.get(ids.get("A")!)).toBe(0);
    expect(betweenness.get(ids.get("B")!)).toBe(1);
    expect(betweenness.get(ids.get("C")!)).toBe(0);
  });

  it("does not count a node as a bridge when a direct shortcut exists", () => {
    const ids = insertGraph([
      ["A", "B"],
      ["B", "C"],
      ["A", "C"],
    ]);

    const betweenness = computeBetweennessCentrality(db);

    expect(betweenness.get(ids.get("A")!)).toBe(0);
    expect(betweenness.get(ids.get("B")!)).toBe(0);
    expect(betweenness.get(ids.get("C")!)).toBe(0);
  });

  it("persists betweenness alongside PageRank updates", () => {
    const ids = insertGraph([
      ["A", "B"],
      ["B", "C"],
    ]);

    updateCentralityScores(db);

    const rows = db.prepare("SELECT id, centrality, betweenness FROM symbols ORDER BY id").all() as Array<{
      id: number;
      centrality: number;
      betweenness: number;
    }>;

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.centrality > 0)).toBe(true);
    expect(rows.find((row) => row.id === ids.get("A"))?.betweenness).toBe(0);
    expect(rows.find((row) => row.id === ids.get("B"))?.betweenness).toBe(1);
    expect(rows.find((row) => row.id === ids.get("C"))?.betweenness).toBe(0);
  });
});
