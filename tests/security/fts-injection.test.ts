import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { sanitizeFTS5Term, buildFTS5ORPattern } from "../../src/utils/fts5-sanitize.js";

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

describe("VAL-SEC-004 FTS5 Sanitization", () => {
  describe("VAL-SEC-004a: sanitizeFTS5Term removes all special characters", () => {
    it.each([
      ['foo"bar', 'foobar'], // Double quotes stripped
      ['"test"', 'test'],    // Surrounding quotes stripped
      ['a"b"c', 'abc'],     // Multiple quotes stripped
      ["foo*", "foo"],      // Asterisk stripped
      ["^bar", "bar"],      // Caret stripped
      ["NEAR/5", "NEAR5"],  // Non-alphanumeric chars stripped (harmless literal)
      ["a AND b", "a AND b"], // Boolean ops preserved as literals
    ])("input %p → sanitized %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("VAL-SEC-004b: buildFTS5ORPattern creates valid FTS5 patterns", () => {
    it.each([
      [['foo"bar'], '"foobar"'],              // Quotes stripped, single term
      [['test"'], '"test"'],                 // Trailing quote stripped
      [['a"b', 'c"d'], '"ab" OR "cd"'],     // Quotes stripped in OR pattern
      [['foo*'], '"foo"'],                   // Asterisk stripped
      [['term1', 'term2'], '"term1" OR "term2"'], // Normal OR pattern
    ])("words %p → pattern %p", (words, expected) => {
      expect(buildFTS5ORPattern(words as string[])).toBe(expected);
    });
  });

  describe("VAL-SEC-004c: FTS5 patterns work with real database", () => {
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
        name: "UserService",
        kind: "class",
        startLine: 1,
        endLine: 10,
        signature: "class UserService",
        bodyHash: "hash1",
        fullSource: "class UserService {}",
        isExported: true,
        docComment: null,
        centrality: 0.5,
        lastSeen: Date.now(),
      });
    });

    it("searches with quotes in input do not cause FTS5 syntax errors", () => {
      const symbols = symbolQueries(db);
      // These should not throw even with unsanitized input
      expect(() => symbols.searchFTS('class "User"', 10)).not.toThrow();
      expect(() => symbols.searchFTS('"UserService"', 10)).not.toThrow();
      expect(() => symbols.searchFTS('User"Service', 10)).not.toThrow();
    });

    it("searches still find matches after sanitization", () => {
      const symbols = symbolQueries(db);
      const result = symbols.searchFTS("UserService", 10);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.name).toBe("UserService");
    });
  });
});
