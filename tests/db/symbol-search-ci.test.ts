import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const now = Date.now();

  const fileId = files.insert({
    path: "src/services/auth.ts",
    hash: "h1",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 4,
    error: null,
  });

  // Mix of case variants
  syms.insert({ fileId, name: "generateCapsule", kind: "function", startLine: 1, endLine: 10, signature: "", bodyHash: "bh1", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  syms.insert({ fileId, name: "GenerateCapsule", kind: "function", startLine: 11, endLine: 20, signature: "", bodyHash: "bh2", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  syms.insert({ fileId, name: "GENERATECAPSULE", kind: "function", startLine: 21, endLine: 30, signature: "", bodyHash: "bh3", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
  syms.insert({ fileId, name: "generatePayload", kind: "function", startLine: 31, endLine: 40, signature: "", bodyHash: "bh4", fullSource: "", isExported: true, docComment: null, centrality: 0, lastSeen: now });
});

afterAll(() => db?.close());

describe("symbolQueries.getByNameCI", () => {
  it("finds symbols case-insensitively", () => {
    const syms = symbolQueries(db);
    const results = syms.getByNameCI("generatecapsule");
    expect(results.length).toBe(3); // generateCapsule, GenerateCapsule, GENERATECAPSULE
    const names = results.map((r) => r.name);
    expect(names).toContain("generateCapsule");
    expect(names).toContain("GenerateCapsule");
    expect(names).toContain("GENERATECAPSULE");
  });

  it("does not return symbols that only partially match", () => {
    const syms = symbolQueries(db);
    const results = syms.getByNameCI("generatecapsule");
    const names = results.map((r) => r.name);
    expect(names).not.toContain("generatePayload");
  });

  it("returns empty array when no match", () => {
    const syms = symbolQueries(db);
    const results = syms.getByNameCI("nonexistentsymbol");
    expect(results.length).toBe(0);
  });
});
