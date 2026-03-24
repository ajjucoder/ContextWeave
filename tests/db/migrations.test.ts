import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

describe("migrations", () => {
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

  it("files table has basename column", () => {
    const info = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
    expect(info.some((col) => col.name === "basename")).toBe(true);
  });

  it("covering index on symbols(name, id, file_id) exists", () => {
    const indexes = db.prepare("PRAGMA index_list(symbols)").all() as Array<{ name: string }>;
    expect(indexes.some((idx) => idx.name === "idx_symbols_name_cov")).toBe(true);
  });

  it("covering index on edges(source_symbol_id, target_symbol_id) exists", () => {
    const indexes = db.prepare("PRAGMA index_list(edges)").all() as Array<{ name: string }>;
    expect(indexes.some((idx) => idx.name === "idx_edges_src_cov")).toBe(true);
  });

  it("index on files(basename, path) exists", () => {
    const indexes = db.prepare("PRAGMA index_list(files)").all() as Array<{ name: string }>;
    expect(indexes.some((idx) => idx.name === "idx_files_basename_path")).toBe(true);
  });

  it("v20: idx_observations_file index exists on observations(file_id)", () => {
    const indexes = db.prepare("PRAGMA index_list(observations)").all() as Array<{ name: string }>;
    expect(indexes.some((idx) => idx.name === "idx_observations_file")).toBe(true);
  });

  it("v20: EXPLAIN QUERY PLAN uses idx_observations_file for file_id lookup", () => {
    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM observations WHERE file_id = ?")
      .all(1) as Array<{ detail: string }>;
    const usesIndex = plan.some(
      (row) => row.detail && row.detail.includes("idx_observations_file")
    );
    expect(usesIndex).toBe(true);
  });

  it("v21: symbols table has betweenness column", () => {
    const info = db.prepare("PRAGMA table_info(symbols)").all() as Array<{ name: string }>;
    expect(info.some((col) => col.name === "betweenness")).toBe(true);
  });

  it("v21: edges table has strength column with default 1.0", () => {
    const info = db.prepare("PRAGMA table_info(edges)").all() as Array<{ name: string; dflt_value: string | null }>;
    const strengthColumn = info.find((col) => col.name === "strength");
    expect(strengthColumn).toBeDefined();
    expect(strengthColumn?.dflt_value).toBe("1.0");
  });

  it("v22: symbols table has visibility column with default public", () => {
    const info = db.prepare("PRAGMA table_info(symbols)").all() as Array<{ name: string; dflt_value: string | null }>;
    const visibilityColumn = info.find((col) => col.name === "visibility");
    expect(visibilityColumn).toBeDefined();
    expect(visibilityColumn?.dflt_value).toBe("'public'");
  });

  it("v23: symbol_embeddings table stores embeddings per symbol with cascade delete", () => {
    const info = db.prepare("PRAGMA table_info(symbol_embeddings)").all() as Array<{
      name: string;
      pk: number;
      type: string;
    }>;
    expect(info.map((column) => column.name)).toEqual([
      "symbol_id",
      "embedding",
      "model_name",
      "created_at",
    ]);
    expect(info.find((column) => column.name === "symbol_id")?.pk).toBe(1);
    expect(info.find((column) => column.name === "embedding")?.type).toBe("BLOB");

    const foreignKeys = db.prepare("PRAGMA foreign_key_list(symbol_embeddings)").all() as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    expect(foreignKeys).toEqual([
      expect.objectContaining({
        table: "symbols",
        from: "symbol_id",
        on_delete: "CASCADE",
      }),
    ]);
  });

  it("v23: chunk_embeddings table tracks file ranges and cascades on file delete", () => {
    const info = db.prepare("PRAGMA table_info(chunk_embeddings)").all() as Array<{
      name: string;
      pk: number;
      type: string;
    }>;
    expect(info.map((column) => column.name)).toEqual([
      "id",
      "file_id",
      "start_line",
      "end_line",
      "text_hash",
      "embedding",
      "model_name",
    ]);
    expect(info.find((column) => column.name === "id")?.pk).toBe(1);
    expect(info.find((column) => column.name === "embedding")?.type).toBe("BLOB");

    const foreignKeys = db.prepare("PRAGMA foreign_key_list(chunk_embeddings)").all() as Array<{
      table: string;
      from: string;
      on_delete: string;
    }>;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "files",
          from: "file_id",
          on_delete: "CASCADE",
        }),
        expect.objectContaining({
          table: "chunks",
          from: "id",
          on_delete: "CASCADE",
        }),
      ])
    );
  });
});
