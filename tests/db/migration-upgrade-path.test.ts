import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";

describe("DB migration upgrade path", () => {
  it("runs all migrations on a fresh database without error", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });

  it("creates all expected tables after full migration", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("files");
    expect(tableNames).toContain("symbols");
    expect(tableNames).toContain("edges");
    expect(tableNames).toContain("session_context");
    expect(tableNames).toContain("file_summaries");
    expect(tableNames).toContain("file_clusters");
    expect(tableNames).toContain("schema_migrations");

    db.close();
  });

  it("records all 5 migration versions in schema_migrations", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    const versions = applied.map((r) => r.version);

    expect(versions).toEqual([1, 2, 3, 4, 5]);

    db.close();
  });

  it("is idempotent — running migrations twice does not throw", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    expect(() => {
      runMigrations(db);
      runMigrations(db);
    }).not.toThrow();

    db.close();
  });

  it("does not duplicate schema_migrations rows on second run", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    runMigrations(db);
    runMigrations(db);

    const count = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM schema_migrations")
        .get() as { cnt: number }
    ).cnt;

    expect(count).toBe(5);

    db.close();
  });

  it("preserves existing data through migration", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const now = Date.now();
    db.prepare(
      "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("src/test.ts", "abc123", now, now, "typescript", 5, null);

    runMigrations(db);

    const file = db
      .prepare("SELECT * FROM files WHERE path = 'src/test.ts'")
      .get() as { path: string; hash: string } | undefined;

    expect(file).toBeDefined();
    expect(file!.hash).toBe("abc123");

    db.close();
  });

  it("creates symbols_fts virtual table (v2)", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='symbols_fts'"
      )
      .get();

    expect(row).toBeTruthy();

    db.close();
  });

  it("creates file_summaries_fts virtual table (v4)", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='file_summaries_fts'"
      )
      .get();

    expect(row).toBeTruthy();

    db.close();
  });

  it("file_clusters has cluster_id index (v5)", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const indexes = db
      .prepare("PRAGMA index_list(file_clusters)")
      .all() as Array<{ name: string }>;

    expect(indexes.some((idx) => idx.name === "idx_file_clusters_cluster")).toBe(true);

    db.close();
  });
});
