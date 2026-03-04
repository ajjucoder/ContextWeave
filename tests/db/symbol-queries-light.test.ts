import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";

let db: Database.Database;
let fileId: number;

beforeAll(() => {
  db = new Database(":memory:");
  runMigrations(db);

  const files = fileQueries(db);
  fileId = files.insert({
    path: "/tmp/foo.ts",
    hash: "abc",
    lastIndexed: Date.now(),
    mtime: Date.now(),
    language: "typescript",
    symbolCount: 2,
    error: null,
  });

  const syms = symbolQueries(db);
  syms.insert({
    fileId,
    name: "myFunc",
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: "function myFunc()",
    bodyHash: "h1",
    fullSource: "function myFunc() { return 42; }",
    isExported: true,
    docComment: null,
    centrality: 0.5,
    lastSeen: Date.now(),
  });
  syms.insert({
    fileId,
    name: "MyClass",
    kind: "class",
    startLine: 12,
    endLine: 30,
    signature: "class MyClass",
    bodyHash: "h2",
    fullSource: "class MyClass { constructor() {} }",
    isExported: false,
    docComment: null,
    centrality: 0.3,
    lastSeen: Date.now(),
  });
});

afterAll(() => db?.close());

describe("light symbol queries", () => {
  it("getByFileIdLight returns symbols without fullSource", () => {
    const syms = symbolQueries(db);
    const results = syms.getByFileIdLight(fileId);
    expect(results.length).toBe(2);
    for (const sym of results) {
      expect((sym as Record<string, unknown>)["fullSource"]).toBeUndefined();
      expect(sym.name).toBeDefined();
      expect(sym.signature).toBeDefined();
    }
  });

  it("getByNameLight returns matching symbols without fullSource", () => {
    const syms = symbolQueries(db);
    const results = syms.getByNameLight("myFunc");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("myFunc");
    expect((results[0] as Record<string, unknown>)["fullSource"]).toBeUndefined();
  });

  it("getByNameLight returns empty array for no match", () => {
    const syms = symbolQueries(db);
    expect(syms.getByNameLight("nonExistent")).toHaveLength(0);
  });
});
