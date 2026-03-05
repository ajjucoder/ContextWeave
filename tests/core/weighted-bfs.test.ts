import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  const barrelFileId = files.insert({ path: "src/core/barrel.ts", hash: "d", lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });

  const mainFn = syms.insert({ fileId: mainFileId, name: "processData", kind: "function", startLine: 1, endLine: 10, signature: "function processData()", bodyHash: "x1", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const helperFn = syms.insert({ fileId: helperFileId, name: "validateInput", kind: "function", startLine: 1, endLine: 5, signature: "function validateInput()", bodyHash: "x2", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const deepFn = syms.insert({ fileId: helperFileId, name: "deepDependency", kind: "function", startLine: 7, endLine: 11, signature: "function deepDependency()", bodyHash: "x2b", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  const testFn = syms.insert({ fileId: testFileId, name: "testProcessData", kind: "function", startLine: 1, endLine: 20, signature: "function testProcessData()", bodyHash: "x3", fullSource: "", isExported: false, docComment: null, centrality: 0, lastSeen: now });
  const barrelFn = syms.insert({ fileId: barrelFileId, name: "barrelProxy", kind: "function", startLine: 1, endLine: 3, signature: "function barrelProxy()", bodyHash: "x4", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });

  edges.insert({ sourceSymbolId: mainFn, targetSymbolId: helperFn, kind: "import", createdAt: now });
  edges.insert({ sourceSymbolId: testFn, targetSymbolId: mainFn, kind: "call", createdAt: now });
  edges.insert({ sourceSymbolId: mainFn, targetSymbolId: barrelFn, kind: "reexport", createdAt: now });
  edges.insert({ sourceSymbolId: barrelFn, targetSymbolId: deepFn, kind: "call", createdAt: now });
});

afterAll(() => db?.close());

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

  it("respects maxVisitedNodes cap — stops expanding after limit", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    // cap at 1 node: only the pivot itself
    const nodes = weightedBfsTraversal(db, [mainSym.id], 10, null, { maxVisitedNodes: 1 });
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.symbolId).toBe(mainSym.id);
  });

  it("incoming edges cost more than outgoing edges with default multiplier", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodes = weightedBfsTraversal(db, [mainSym.id], 10);

    // helperFn is reached via outgoing import (low cost)
    // testFn is reached via incoming call (higher cost due to 1.5x multiplier)
    const helperNode = nodes.find((n) => syms.getById(n.symbolId)?.name === "validateInput");
    const testNode = nodes.find((n) => syms.getById(n.symbolId)?.name === "testProcessData");

    expect(helperNode).toBeDefined();
    expect(testNode).toBeDefined();
    // incoming edge cost = 1.0 (call) * 1.8 (test dir) * 1.5 (incoming mult) = 2.7
    // outgoing edge cost = 0.8 (import) * 0.6 (same dir) = 0.48
    expect(testNode!.distance).toBeGreaterThan(helperNode!.distance);
  });

  it("incomingEdgeCostMultiplier=1.0 makes incoming and outgoing symmetric", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodesSymmetric = weightedBfsTraversal(db, [mainSym.id], 10, null, { incomingEdgeCostMultiplier: 1.0 });
    const nodesDefault = weightedBfsTraversal(db, [mainSym.id], 10);

    const testSymmetric = nodesSymmetric.find((n) => syms.getById(n.symbolId)?.name === "testProcessData");
    const testDefault = nodesDefault.find((n) => syms.getById(n.symbolId)?.name === "testProcessData");

    expect(testSymmetric).toBeDefined();
    expect(testDefault).toBeDefined();
    // with 1.0 multiplier, testFn is closer than with 1.5 multiplier
    expect(testSymmetric!.distance).toBeLessThan(testDefault!.distance);
  });

  it("applies lower traversal cost to reexport edges than regular import edges", () => {
    const syms = symbolQueries(db);
    const mainSym = syms.getByName("processData")[0]!;
    const nodes = weightedBfsTraversal(db, [mainSym.id], 5);
    const barrelNode = nodes.find((n) => syms.getById(n.symbolId)?.name === "barrelProxy");
    const helperNode = nodes.find((n) => syms.getById(n.symbolId)?.name === "validateInput");

    expect(barrelNode).toBeDefined();
    expect(helperNode).toBeDefined();
    expect(barrelNode!.distance).toBeLessThan(helperNode!.distance);
  });
});
