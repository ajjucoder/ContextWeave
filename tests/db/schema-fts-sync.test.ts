import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

describe("createSchema FTS sync", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  it("keeps symbols_fts in sync for inserts", () => {
    db.prepare(
      "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count) VALUES (?, '', 0, 0, 'typescript', 1)"
    ).run("/tmp/sample.ts");
    const fileId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

    db.prepare(
      "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, ?, 'function', 1, 5, 'foo()', '', '', 1, 0, 0)"
    ).run(fileId, "UserService");

    const results = symbolQueries(db).searchFTS("UserService", 5);
    expect(results.some((s) => s.name === "UserService")).toBe(true);
  });

  it("updates FTS rows only when symbol name/kind changes", () => {
    const trigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'symbols_au'")
      .get() as { sql: string } | undefined;

    expect(trigger).toBeTruthy();
    expect(trigger?.sql).toContain("AFTER UPDATE OF name, kind ON symbols");
  });
});
