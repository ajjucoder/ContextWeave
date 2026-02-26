import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

describe("migration v2", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("creates symbols_fts table", () => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='symbols_fts'")
      .get();
    expect(row).toBeTruthy();
  });

  it("files table has mtime column", () => {
    const info = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
    expect(info.some((col) => col.name === "mtime")).toBe(true);
  });

  it("covering index on symbols(name, id, file_id) exists", () => {
    const indexes = db.prepare("PRAGMA index_list(symbols)").all() as Array<{ name: string }>;
    expect(indexes.some((idx) => idx.name === "idx_symbols_name_cov")).toBe(true);
  });

  it("covering index on edges(source_symbol_id, target_symbol_id) exists", () => {
    const indexes = db.prepare("PRAGMA index_list(edges)").all() as Array<{ name: string }>;
    expect(indexes.some((idx) => idx.name === "idx_edges_src_cov")).toBe(true);
  });
});
