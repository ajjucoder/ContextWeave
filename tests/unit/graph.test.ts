import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { bfsTraversal, computePageRank, getDepthForBudget } from "../../src/core/graph.js";

let db: Database.Database;

function createTestGraph(db: Database.Database) {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  const fileId = files.insert({
    path: "/test.ts",
    hash: "h1",
    lastIndexed: now,
    language: "typescript",
    symbolCount: 4,
    error: null,
  });

  const sym = (name: string) =>
    symbols.insert({
      fileId,
      name,
      kind: "function",
      startLine: 1,
      endLine: 3,
      signature: `function ${name}()`,
      bodyHash: `bh_${name}`,
      fullSource: `function ${name}() {}`,
      isExported: false,
      docComment: null,
      centrality: 0,
      lastSeen: now,
    });

  const a = sym("funcA");
  const b = sym("funcB");
  const c = sym("funcC");
  const d = sym("funcD");

  edges.insert({ sourceSymbolId: a, targetSymbolId: b, kind: "call", createdAt: now });
  edges.insert({ sourceSymbolId: b, targetSymbolId: c, kind: "call", createdAt: now });
  edges.insert({ sourceSymbolId: c, targetSymbolId: d, kind: "call", createdAt: now });

  return { a, b, c, d };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterEach(() => {
  db.close();
});

describe("bfsTraversal", () => {
  it("finds nodes at correct distances", () => {
    const { a } = createTestGraph(db);
    const nodes = bfsTraversal(db, [a], 10);

    const byId = new Map(nodes.map((n) => [n.symbolId, n.distance]));
    expect(byId.get(a)).toBe(0);

    const distances = [...byId.values()];
    expect(distances).toContain(0);
    expect(Math.max(...distances)).toBeGreaterThan(0);
  });

  it("respects max depth", () => {
    const { a } = createTestGraph(db);
    const shallow = bfsTraversal(db, [a], 1);
    const deep = bfsTraversal(db, [a], 10);

    expect(shallow.length).toBeLessThanOrEqual(deep.length);
  });

  it("handles multiple pivots", () => {
    const { a, d } = createTestGraph(db);
    const nodes = bfsTraversal(db, [a, d], 10);

    const ids = nodes.map((n) => n.symbolId);
    expect(ids).toContain(a);
    expect(ids).toContain(d);
  });
});

describe("computePageRank", () => {
  it("computes centrality scores", () => {
    createTestGraph(db);
    const ranks = computePageRank(db);

    expect(ranks.size).toBe(4);
    for (const rank of ranks.values()) {
      expect(rank).toBeGreaterThan(0);
      expect(rank).toBeLessThan(1);
    }
  });

  it("sums to approximately 1.0", () => {
    createTestGraph(db);
    const ranks = computePageRank(db);
    const sum = [...ranks.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });
});

describe("getDepthForBudget", () => {
  it("returns appropriate depths", () => {
    expect(getDepthForBudget(1000)).toBe(3);
    expect(getDepthForBudget(3000)).toBe(4);
    expect(getDepthForBudget(7000)).toBe(5);
    expect(getDepthForBudget(15000)).toBe(6);
  });
});
