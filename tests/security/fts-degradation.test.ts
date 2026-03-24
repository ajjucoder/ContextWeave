import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

describe("symbolQueries.searchFTS graceful degradation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    const fileId = fileQueries(db).insert({
      path: "src/search.ts",
      basename: "search.ts",
      hash: "hash",
      lastIndexed: Date.now(),
      mtime: Date.now(),
      language: "typescript",
      symbolCount: 1,
      error: null,
    });

    symbolQueries(db).insert({
      fileId,
      name: "searchFTS",
      kind: "function",
      startLine: 1,
      endLine: 5,
      signature: "function searchFTS()",
      bodyHash: "body-hash",
      fullSource: "function searchFTS() {}",
      isExported: true,
      docComment: null,
      centrality: 0.5,
      lastSeen: Date.now(),
    });
  });

  it("returns [] without throwing when the FTS table has been dropped", () => {
    db.exec("DROP TABLE symbols_fts");

    const symbols = symbolQueries(db);

    expect(() => symbols.searchFTS("searchFTS", 10)).not.toThrow();
    expect(symbols.searchFTS("searchFTS", 10)).toEqual([]);
  });

  it("returns [] without throwing when the FTS table is corrupted into a plain table", () => {
    db.exec("DROP TABLE symbols_fts");
    db.exec("CREATE TABLE symbols_fts(rowid INTEGER PRIMARY KEY, name TEXT, kind TEXT)");

    const symbols = symbolQueries(db);

    expect(() => symbols.searchFTS("searchFTS", 10)).not.toThrow();
    expect(symbols.searchFTS("searchFTS", 10)).toEqual([]);
  });
});
