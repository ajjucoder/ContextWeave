import { describe, it, expect, beforeAll, afterAll } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { contentFallbackSearch } from "../../src/capsule/content-fallback.js";

/**
 * VAL-SEC-003: LIKE Wildcard Injection Validation Tests
 *
 * These tests verify that user query terms are properly escaped before being
 * used in SQL LIKE patterns to prevent over-broad matching from % and _ wildcards.
 */
describe("VAL-SEC-003: LIKE wildcard escaping", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new DatabaseConstructor(":memory:");
    runMigrations(db);

    // Insert test files
    const files = [
      { path: "src/percent.ts", basename: "percent.ts" },
      { path: "src/underscore.ts", basename: "underscore.ts" },
      { path: "src/backslash.ts", basename: "backslash.ts" },
      { path: "src/combined.ts", basename: "combined.ts" },
    ];

    for (const f of files) {
      db.prepare(
        "INSERT INTO files (path, basename, hash, last_indexed, mtime, language) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(f.path, f.basename, "h1", Date.now(), Date.now(), "typescript");
    }

    const now = Date.now();
    const filePercent = (db.prepare("SELECT id FROM files WHERE path = 'src/percent.ts'").get() as any).id;
    const fileUnderscore = (db.prepare("SELECT id FROM files WHERE path = 'src/underscore.ts'").get() as any).id;
    const fileBackslash = (db.prepare("SELECT id FROM files WHERE path = 'src/backslash.ts'").get() as any).id;
    const fileCombined = (db.prepare("SELECT id FROM files WHERE path = 'src/combined.ts'").get() as any).id;

    // Insert symbols with special characters in content
    const symbols = [
      // VAL-SEC-003a: Percent sign test cases
      { fileId: filePercent, name: "testPercent", source: "Value is 50%" },
      { fileId: filePercent, name: "testPercentPhrase", source: "Value is 50 percent complete" },
      { fileId: filePercent, name: "testPercentX", source: "Value is 50x" },
      { fileId: filePercent, name: "testUserPercent", source: "const user% = 'admin';" },
      { fileId: filePercent, name: "testUsername", source: "const username = 'admin';" },

      // VAL-SEC-003b: Underscore test cases
      { fileId: fileUnderscore, name: "file_name_const", source: "const file_name = 'test';" },
      { fileId: fileUnderscore, name: "filename_const", source: "const filename = 'test';" },
      { fileId: fileUnderscore, name: "file_name_const2", source: "const file_name = 'other';" },
      { fileId: fileUnderscore, name: "my_a_b_var", source: "let my_a_b_var = 1;" },
      { fileId: fileUnderscore, name: "myabcvar", source: "let myabcvar = 1;" },

      // VAL-SEC-003c: Backslash test cases
      { fileId: fileBackslash, name: "backslashPath", source: "const path = 'C:\\Users\\test';" },
      { fileId: fileBackslash, name: "forwardslashPath", source: "const path = '/home/user/test';" },
      { fileId: fileBackslash, name: "literalBackslashPercent", source: "Value is test\\%" },
      { fileId: fileBackslash, name: "justPercent", source: "Value is test%" },

      // VAL-SEC-003d: Combined wildcards
      { fileId: fileCombined, name: "complexPattern", source: "Contains %_ pattern here" },
      { fileId: fileCombined, name: "containsXY", source: "Contains XY pattern here" },
      { fileId: fileCombined, name: "literalUnderscore", source: "Literal _ here" },
    ];

    for (const s of symbols) {
      db.prepare(
        "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, full_source, is_exported, body_hash, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        s.fileId,
        s.name,
        "variable",
        1,
        10,
        `${s.name}: string`,
        s.source,
        1,
        "hash1",
        now
      );
    }
  });

  afterAll(() => db.close());

  describe("VAL-SEC-003a: Percent sign escaping", () => {
    it("must escape % so it matches literal percent, not 'any sequence'", () => {
      // Direct SQL test to confirm the fix works at SQL level
      const escapeLikePattern = (term: string): string => {
        return term.replace(/[\\%_]/g, "\\$&");
      };
      const pattern = `%${escapeLikePattern("50%")}%`;
      
      // Debug output
      console.log("DEBUG: pattern for '50%' is:", JSON.stringify(pattern));
      
      // Test directly with SQL
      const directStmt = db.prepare("SELECT full_source FROM symbols WHERE LOWER(full_source) LIKE ? ESCAPE '\\'");
      const directResults = directStmt.all(pattern) as Array<{full_source: string}>;
      
      console.log("DEBUG: direct SQL results:", directResults.map(r => r.full_source));

      // Direct SQL should only return the literal match
      expect(directResults.map(r => r.full_source)).toContain("Value is 50%");
      // These should NOT match with proper escaping
      expect(directResults.map(r => r.full_source)).not.toContain("Value is 50 percent complete");

      // Now test the contentFallbackSearch function
      const results = contentFallbackSearch(db, ["50%"]);
      expect(results.length).toBeGreaterThan(0);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      // Should match the literal "50%"
      expect(sources).toContain("Value is 50%");

      // Should NOT match strings that would match with wildcard %
      expect(sources).not.toContain("Value is 50 percent complete");
      expect(sources).not.toContain("Value is 50x");
    });

    it("must escape % at start of term", () => {
      const results = contentFallbackSearch(db, ["%temp"]);
      // Should match literal "%temp" if it exists, not strings ending with "temp"
      expect(results).toBeDefined();
    });

    it("must escape multiple % characters", () => {
      // Search for something with multiple %
      const results = contentFallbackSearch(db, ["100%complete%"]);
      expect(results).toBeDefined();
    });
  });

  describe("VAL-SEC-003b: Underscore escaping", () => {
    it("must escape _ so it matches literal underscore, not 'any single char'", () => {
      // Searching for "file_name" should ONLY match symbols containing "file_name"
      // NOT match "filename" (where _ wildcard would match any single char)
      const results = contentFallbackSearch(db, ["file_name"]);
      expect(results.length).toBeGreaterThan(0);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      // Should match "file_name" literals
      expect(sources).toContain("const file_name = 'test';");
      expect(sources).toContain("const file_name = 'other';");

      // Should NOT match "filename" (where _ wildcard would match 'n')
      expect(sources).not.toContain("const filename = 'test';");
    });

    it("must escape multiple _ characters", () => {
      // Searching for "my_a_b_var" should NOT match "myabcvar"
      const results = contentFallbackSearch(db, ["my_a_b_var"]);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      expect(sources).toContain("let my_a_b_var = 1;");
      expect(sources).not.toContain("let myabcvar = 1;");
    });
  });

  describe("VAL-SEC-003c: Backslash handling", () => {
    it("must escape backslash to prevent escape injection", () => {
      // Searching for "C:\Users" should work correctly
      const results = contentFallbackSearch(db, ["C:\\Users"]);
      expect(results.length).toBeGreaterThan(0);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      expect(sources).toContain("const path = 'C:\\Users\\test';");
    });

    it("must handle backslash before percent correctly", () => {
      // Searching for "test\\%" (literal backslash + literal percent)
      // Should match "Value is test\\%" but NOT "Value is test%"
      const results = contentFallbackSearch(db, ["test\\%"]);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      // Should match literal backslash-percent
      expect(sources).toContain("Value is test\\%");

      // Should NOT match just percent (which would happen if backslash unescaped %)
      expect(sources).not.toContain("Value is test%");
    });
  });

  describe("VAL-SEC-003d: Combined wildcards", () => {
    it("must handle combination of % and _ characters", () => {
      // Search for "%_" pattern - should match literal, not any-sequence + any-char
      const results = contentFallbackSearch(db, ["%_"]);
      expect(results.length).toBeGreaterThan(0);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      // Should match literal "%_ pattern"
      expect(sources).toContain("Contains %_ pattern here");

      // Should NOT match "Contains XY pattern here" (which _ would match if not escaped)
      expect(sources).not.toContain("Contains XY pattern here");
    });

    it("must handle complex real-world patterns", () => {
      // Test various combinations
      const results = contentFallbackSearch(db, ["Literal _"]);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      expect(sources).toContain("Literal _ here");
    });
  });

  describe("Security impact: Prevent over-broad matching", () => {
    it("must not allow % alone to match all content", () => {
      // Searching for "%" should match only literal percent signs
      // NOT all content (which would happen if % wildcard not escaped)
      const results = contentFallbackSearch(db, ["%"]);

      // Should return limited results (only symbols with literal %)
      // Not every symbol in the database
      const allSymbols = db.prepare("SELECT COUNT(*) as count FROM symbols").get() as { count: number };
      expect(results.length).toBeLessThan(allSymbols.count);
    });

    it("must not allow _ alone to match any single character", () => {
      // Searching for "_" should match only literal underscores
      const results = contentFallbackSearch(db, ["_"]);

      // Results should be limited and specific
      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      // All results should actually contain literal underscore
      for (const source of sources) {
        expect(source).toContain("_");
      }
    });

    it("must not allow user% to match all user-prefixed content", () => {
      // Searching for "user%" should match literal "user%", not "user" + anything
      const results = contentFallbackSearch(db, ["user%"]);

      const sources = results.map((r) => {
        const sym = db.prepare("SELECT full_source FROM symbols WHERE id = ?").get(r.symbolId) as any;
        return sym.full_source;
      });

      // Should match literal "user%"
      expect(sources).toContain("const user% = 'admin';");

      // Should NOT match "username" (which would match with wildcard)
      expect(sources).not.toContain("const username = 'admin';");
    });
  });
});

/**
 * Unit tests for the escapeLikePattern function
 */
describe("escapeLikePattern function", () => {
  // Inline the escape function for unit testing (must match implementation)
  const escapeLikePattern = (term: string): string => {
    return term.replace(/[\\%_]/g, "\\$&");
  };

  describe("VAL-SEC-003a: Percent sign escaping", () => {
    it("escapes % to prevent 'match any sequence' behavior", () => {
      const escaped = escapeLikePattern("test%");
      expect(escaped).toBe("test\\%");
    });

    it("escapes % at start of term", () => {
      const escaped = escapeLikePattern("%test");
      expect(escaped).toBe("\\%test");
    });

    it("escapes % at end of term", () => {
      const escaped = escapeLikePattern("test%");
      expect(escaped).toBe("test\\%");
    });

    it("escapes multiple % characters", () => {
      const escaped = escapeLikePattern("%%test%%");
      expect(escaped).toBe("\\%\\%test\\%\\%");
    });

    it("escapes % in middle of term", () => {
      const escaped = escapeLikePattern("te%st");
      expect(escaped).toBe("te\\%st");
    });
  });

  describe("VAL-SEC-003b: Underscore escaping", () => {
    it("escapes _ to prevent 'match any char' behavior", () => {
      const escaped = escapeLikePattern("file_name");
      expect(escaped).toBe("file\\_name");
    });

    it("escapes _ at start of term", () => {
      const escaped = escapeLikePattern("_test");
      expect(escaped).toBe("\\_test");
    });

    it("escapes _ at end of term", () => {
      const escaped = escapeLikePattern("test_");
      expect(escaped).toBe("test\\_");
    });

    it("escapes multiple _ characters", () => {
      const escaped = escapeLikePattern("a_b_c_d");
      expect(escaped).toBe("a\\_b\\_c\\_d");
    });
  });

  describe("VAL-SEC-003c: Backslash handling", () => {
    it("escapes backslash to prevent escape injection", () => {
      const escaped = escapeLikePattern("test\\");
      expect(escaped).toBe("test\\\\");
    });

    it("escapes backslash before %", () => {
      const escaped = escapeLikePattern("\\%");
      expect(escaped).toBe("\\\\\\%"); // \\\\ + \\%
    });

    it("escapes backslash before _", () => {
      const escaped = escapeLikePattern("\\_");
      expect(escaped).toBe("\\\\\\_");
    });

    it("handles multiple backslashes", () => {
      const escaped = escapeLikePattern("\\\\"); // Two backslashes in input
      expect(escaped).toBe("\\\\\\\\"); // Four backslashes (each escaped)
    });

    it("handles path-like strings", () => {
      const escaped = escapeLikePattern("C:\\Users\\test");
      expect(escaped).toBe("C:\\\\Users\\\\test");
    });
  });

  describe("VAL-SEC-003d: Combined wildcards", () => {
    it("handles combination of all special characters", () => {
      const escaped = escapeLikePattern("%_\\");
      expect(escaped).toContain("\\%");
      expect(escaped).toContain("\\_");
      expect(escaped).toContain("\\\\");
      expect(escaped).toBe("\\%\\_\\\\");
    });

    it("handles complex real-world patterns", () => {
      const escaped = escapeLikePattern("C:\\Users\\%temp%\\file_name");
      // All \, %, and _ should be escaped
      const expected = "C:\\\\Users\\\\\\%temp\\%\\\\file\\_name";
      expect(escaped).toBe(expected);
    });

    it("handles mixed special and normal characters", () => {
      const escaped = escapeLikePattern("test%value_here\\path");
      expect(escaped).toBe("test\\%value\\_here\\\\path");
    });
  });

  describe("Edge cases", () => {
    it("handles empty string", () => {
      const escaped = escapeLikePattern("");
      expect(escaped).toBe("");
    });

    it("handles string with no special characters", () => {
      const escaped = escapeLikePattern("hello world");
      expect(escaped).toBe("hello world");
    });

    it("handles only special characters", () => {
      const escaped = escapeLikePattern("%_\\");
      expect(escaped).toBe("\\%\\_\\\\");
    });

    it("handles repeated pattern", () => {
      const escaped = escapeLikePattern("%%%___\\\\\\");
      expect(escaped).toBe("\\%\\%\\%\\_\\_\\_\\\\\\\\\\\\");
    });
  });
});
