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
});
