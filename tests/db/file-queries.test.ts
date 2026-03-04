import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

function insertFile(path: string): number {
  const files = fileQueries(db);
  return files.insert({
    path,
    hash: "abc",
    lastIndexed: Date.now(),
    mtime: Date.now(),
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
}

describe("getByPathSuffix", () => {
  it("finds file by exact path match", () => {
    const id = insertFile("src/core/parser.ts");
    const files = fileQueries(db);
    const found = files.getByPathSuffix("src/core/parser.ts");
    expect(found).toBeDefined();
    expect(found!.id).toBe(id);
  });

  it("finds file by path suffix when preceded by slash", () => {
    insertFile("/Users/dev/project/src/core/parser.ts");
    const files = fileQueries(db);
    const found = files.getByPathSuffix("core/parser.ts");
    expect(found).toBeDefined();
    expect(found!.path).toBe("/Users/dev/project/src/core/parser.ts");
  });

  it("returns shortest path match when multiple files share a suffix", () => {
    insertFile("/long/nested/path/src/utils/helper.ts");
    insertFile("src/utils/helper.ts");
    const files = fileQueries(db);
    const found = files.getByPathSuffix("utils/helper.ts");
    expect(found).toBeDefined();
    expect(found!.path).toBe("src/utils/helper.ts");
  });

  it("returns undefined for non-existent suffix", () => {
    insertFile("src/core/parser.ts");
    const files = fileQueries(db);
    const found = files.getByPathSuffix("nonexistent/file.ts");
    expect(found).toBeUndefined();
  });

  it("does not false-match partial directory names", () => {
    insertFile("src/authentication/handler.ts");
    const files = fileQueries(db);
    const found = files.getByPathSuffix("tion/handler.ts");
    expect(found).toBeUndefined();
  });

  it("handles special SQL characters in path without errors", () => {
    insertFile("src/components/[id]/page.ts");
    const files = fileQueries(db);
    const found = files.getByPathSuffix("[id]/page.ts");
    expect(found).toBeDefined();
    expect(found!.path).toBe("src/components/[id]/page.ts");
  });
});
