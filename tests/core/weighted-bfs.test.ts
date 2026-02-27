import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { weightedBfsTraversal } from "../../src/core/weighted-bfs.js";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  const mainFileId = files.insert({ path: "src/core/main.ts", hash: "a", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const helperFileId = files.insert({ path: "src/core/helper.ts", hash: "b", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
  const testFileId = files.insert({ path: "tests/main.test.ts", hash: "c", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });

  const mainFn = syms.insert({ fileId: mainFileId, name: "processData", kind: "function", startLine: 1, endLine: 10, signature: "function processData()", bodyHash: "x1", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const helperFn = syms.insert({ fileId: helperFileId, name: "validateInput", kind: "function", startLine: 1, endLine: 5, signature: "function validateInput()", bodyHash: "x2", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const testFn = syms.insert({ fileId: testFileId, name: "testProcessData", kind: "function", startLine: 1, endLine: 20, signature: "function testProcessData()", bodyHash: "x3", fullSource: "", isExported: false, docComment: null, centrality: 0, lastSeen: now });

  edges.insert({ sourceSymbolId: mainFn, targetSymbolId: helperFn, kind: "import", createdAt: now });
  edges.insert({ sourceSymbolId: testFn, targetSymbolId: mainFn, kind: "call", createdAt: now });
});

describe("weightedBfsTraversal", () => {
  it("reaches same-dir imports at lower effective distance than test-dir calls", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodes = weightedBfsTraversal(db, [mainSym.id], 3);

    const helperNode = nodes.find((n) => {
      const s = syms.getById(n.symbolId);
      return s?.name === "validateInput";
    });
    const testNode = nodes.find((n) => {
      const s = syms.getById(n.symbolId);
      return s?.name === "testProcessData";
    });

    expect(helperNode).toBeDefined();
    expect(testNode).toBeDefined();
    expect(helperNode!.distance).toBeLessThan(testNode!.distance);
  });

  it("returns pivot node itself at distance 0", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodes = weightedBfsTraversal(db, [mainSym.id], 3);

    const pivotNode = nodes.find((n) => n.symbolId === mainSym.id);
    expect(pivotNode).toBeDefined();
    expect(pivotNode!.distance).toBe(0);
  });

  it("respects maxDepth — does not expand beyond it", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodes = weightedBfsTraversal(db, [mainSym.id], 0.5);

    expect(nodes.every((n) => n.distance < 0.5)).toBe(true);
  });
});
