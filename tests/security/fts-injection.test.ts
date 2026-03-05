import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";

describe("FTS5 injection protection", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    const files = fileQueries(db);
    const fileId = files.insert({
      path: "src/test.ts",
      basename: "test.ts",
      hash: "abc",
      lastIndexed: Date.now(),
      mtime: Date.now(),
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    symbolQueries(db).insert({
      fileId,
      name: "testFunction",
      kind: "function",
      startLine: 1,
      endLine: 5,
      signature: "function testFunction()",
      bodyHash: "hash1",
      fullSource: "function testFunction() {}",
      isExported: true,
      docComment: null,
      centrality: 0.5,
      lastSeen: Date.now(),
    });
  });

  it("handles FTS5 special characters without crashing", () => {
    const symbols = symbolQueries(db);
    const malicious = [
      'test" OR 1=1 --',
      "test*",
      "test AND NEAR(a,b)",
      "test} {drop table",
      '"; DROP TABLE symbols; --',
      "test\x00null",
      "test^NOT",
      "NEAR(a b, 3)",
    ];

    for (const term of malicious) {
      expect(() => symbols.searchFTS(term, 10)).not.toThrow();
    }
  });

  it("returns empty for completely special-character input", () => {
    const symbols = symbolQueries(db);
    const result = symbols.searchFTS("!@#$%^&*()", 10);
    expect(result).toEqual([]);
  });

  it("still finds valid matches after sanitization", () => {
    const symbols = symbolQueries(db);
    const result = symbols.searchFTS("testFunction", 10);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.name).toBe("testFunction");
  });

  it("handles empty and whitespace-only input", () => {
    const symbols = symbolQueries(db);
    expect(symbols.searchFTS("", 10)).toEqual([]);
    expect(symbols.searchFTS("   ", 10)).toEqual([]);
  });
});
