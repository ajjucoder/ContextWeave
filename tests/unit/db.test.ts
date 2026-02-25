import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
});

afterEach(() => {
  db.close();
});

describe("fileQueries", () => {
  it("inserts and retrieves files", () => {
    const files = fileQueries(db);
    const id = files.insert({
      path: "/test/foo.ts",
      hash: "abc123",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 5,
      error: null,
    });

    const file = files.getByPath("/test/foo.ts");
    expect(file).toBeDefined();
    expect(file?.id).toBe(id);
    expect(file?.language).toBe("typescript");
    expect(file?.symbolCount).toBe(5);
  });

  it("counts files", () => {
    const files = fileQueries(db);
    expect(files.count()).toBe(0);

    files.insert({
      path: "/a.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 0,
      error: null,
    });

    expect(files.count()).toBe(1);
  });

  it("deletes files by path", () => {
    const files = fileQueries(db);
    files.insert({
      path: "/del.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 0,
      error: null,
    });

    files.deleteByPath("/del.ts");
    expect(files.getByPath("/del.ts")).toBeUndefined();
  });
});

describe("symbolQueries", () => {
  it("inserts and retrieves symbols", () => {
    const files = fileQueries(db);
    const fileId = files.insert({
      path: "/test.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    const symbols = symbolQueries(db);
    const id = symbols.insert({
      fileId,
      name: "testFn",
      kind: "function",
      startLine: 1,
      endLine: 5,
      signature: "function testFn(): void",
      bodyHash: "bhash1",
      fullSource: "function testFn(): void {}",
      isExported: true,
      docComment: null,
      centrality: 0,
      lastSeen: Date.now(),
    });

    const sym = symbols.getById(id);
    expect(sym).toBeDefined();
    expect(sym?.name).toBe("testFn");
    expect(sym?.kind).toBe("function");
    expect(sym?.isExported).toBe(true);
  });

  it("finds symbols by name", () => {
    const files = fileQueries(db);
    const fileId = files.insert({
      path: "/test.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    const symbols = symbolQueries(db);
    symbols.insert({
      fileId,
      name: "myFunc",
      kind: "function",
      startLine: 1,
      endLine: 3,
      signature: "function myFunc()",
      bodyHash: "bh1",
      fullSource: "function myFunc() {}",
      isExported: false,
      docComment: null,
      centrality: 0,
      lastSeen: Date.now(),
    });

    const results = symbols.getByName("myFunc");
    expect(results.length).toBe(1);
    expect(results[0]?.name).toBe("myFunc");
  });

  it("cascades deletes from files to symbols", () => {
    const files = fileQueries(db);
    const fileId = files.insert({
      path: "/cascade.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    const symbols = symbolQueries(db);
    symbols.insert({
      fileId,
      name: "cascadeFn",
      kind: "function",
      startLine: 1,
      endLine: 3,
      signature: "fn",
      bodyHash: "bh1",
      fullSource: "fn() {}",
      isExported: false,
      docComment: null,
      centrality: 0,
      lastSeen: Date.now(),
    });

    files.deleteById(fileId);
    expect(symbols.getByName("cascadeFn")).toHaveLength(0);
  });
});

describe("edgeQueries", () => {
  it("inserts and queries edges", () => {
    const files = fileQueries(db);
    const fileId = files.insert({
      path: "/edge.ts",
      hash: "h1",
      lastIndexed: Date.now(),
      language: "typescript",
      symbolCount: 2,
      error: null,
    });

    const symbols = symbolQueries(db);
    const id1 = symbols.insert({
      fileId,
      name: "caller",
      kind: "function",
      startLine: 1,
      endLine: 3,
      signature: "fn1",
      bodyHash: "bh1",
      fullSource: "fn1() {}",
      isExported: false,
      docComment: null,
      centrality: 0,
      lastSeen: Date.now(),
    });

    const id2 = symbols.insert({
      fileId,
      name: "callee",
      kind: "function",
      startLine: 5,
      endLine: 7,
      signature: "fn2",
      bodyHash: "bh2",
      fullSource: "fn2() {}",
      isExported: false,
      docComment: null,
      centrality: 0,
      lastSeen: Date.now(),
    });

    const edges = edgeQueries(db);
    edges.insert({
      sourceSymbolId: id1,
      targetSymbolId: id2,
      kind: "call",
      createdAt: Date.now(),
    });

    const outgoing = edges.getBySource(id1);
    expect(outgoing.length).toBe(1);
    expect(outgoing[0]?.targetSymbolId).toBe(id2);
    expect(outgoing[0]?.kind).toBe("call");

    const incoming = edges.getByTarget(id2);
    expect(incoming.length).toBe(1);
    expect(incoming[0]?.sourceSymbolId).toBe(id1);
  });
});
