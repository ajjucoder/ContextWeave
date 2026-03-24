import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { rollbackMigration, runMigrations } from "../../src/db/migrations.js";

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
    expect(tableNames).toContain("chunks");
    expect(tableNames).toContain("chunk_embeddings");
    expect(tableNames).toContain("schema_migrations");

    db.close();
  });

  it("records all migration versions in schema_migrations", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    const versions = applied.map((r) => r.version);

    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);

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

    expect(count).toBe(22);

    db.close();
  });

  it("rolls back migrations 16-22 to version 15", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const now = Date.now();
    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("rollback-session", "claude-code", "/Users/dev/project", now);
    db.prepare(
      "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("src/main.ts", "main.ts", "hash", now, now, "typescript", 1, null);
    db.prepare(
      "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen, parent_symbol_id, qualified_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(1, "main", "function", 1, 3, "function main()", "body", "function main() {}", 1, null, 0, now, null, "main");
    db.prepare(
      "INSERT INTO repo_profile (project_root, profile_json, detected_at) VALUES (?, ?, ?)"
    ).run("/Users/dev/project", "{}", now);
    db.prepare(
      "INSERT INTO conventions (id, name, layer, source, file_count) VALUES (?, ?, ?, ?, ?)"
    ).run("conv-id", "controller", "app", "test", 1);
    db.prepare(
      "INSERT INTO convention_edges (source_convention, target_convention, edge_count) VALUES (?, ?, ?)"
    ).run("conv-id", "conv-id", 1);

    rollbackMigration(db, 15);

    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    expect(applied.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const repoProfileTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repo_profile'")
      .get();
    const conventionsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='conventions'")
      .get();
    const conventionEdgesTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='convention_edges'")
      .get();
    expect(repoProfileTable).toBeUndefined();
    expect(conventionsTable).toBeUndefined();
    expect(conventionEdgesTable).toBeUndefined();

    const file = db
      .prepare("SELECT path, basename FROM files WHERE id = 1")
      .get() as { path: string; basename: string } | undefined;
    expect(file).toEqual({
      path: "/Users/dev/project/src/main.ts",
      basename: "main.ts",
    });

    const symbolColumns = db
      .prepare("PRAGMA table_info(symbols)")
      .all() as Array<{ name: string }>;
    const edgeColumns = db
      .prepare("PRAGMA table_info(edges)")
      .all() as Array<{ name: string }>;
    expect(symbolColumns.some((column) => column.name === "parent_symbol_id")).toBe(false);
    expect(symbolColumns.some((column) => column.name === "qualified_name")).toBe(false);
    expect(symbolColumns.some((column) => column.name === "betweenness")).toBe(false);
    expect(edgeColumns.some((column) => column.name === "strength")).toBe(false);

    db.close();
  });

  it("rolls back applied migrations in reverse version order", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    db.exec(`
      CREATE TABLE rollback_order (
        version INTEGER NOT NULL
      );
      CREATE TRIGGER schema_migrations_delete_audit
      AFTER DELETE ON schema_migrations BEGIN
        INSERT INTO rollback_order(version) VALUES (old.version);
      END;
    `);

    rollbackMigration(db, 15);

    const versions = db
      .prepare("SELECT version FROM rollback_order ORDER BY rowid")
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([22, 21, 20, 19, 18, 17, 16]);

    db.close();
  });

  it("throws when rolling back through a migration without a down function", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    expect(() => rollbackMigration(db, 14)).toThrow(/v15/);

    db.close();
  });

  it("adds betweenness to symbols in v21", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const columns = db.prepare("PRAGMA table_info(symbols)").all() as Array<{ name: string; dflt_value: string | null }>;
    const betweennessColumn = columns.find((column) => column.name === "betweenness");

    expect(betweennessColumn).toBeDefined();
    expect(betweennessColumn?.dflt_value).toBe("0.0");

    db.close();
  });

  it("adds strength to edges in v21", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const columns = db.prepare("PRAGMA table_info(edges)").all() as Array<{ name: string; dflt_value: string | null }>;
    const strengthColumn = columns.find((column) => column.name === "strength");

    expect(strengthColumn).toBeDefined();
    expect(strengthColumn?.dflt_value).toBe("1.0");

    db.close();
  });

  it("adds visibility to symbols in v22", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const columns = db.prepare("PRAGMA table_info(symbols)").all() as Array<{ name: string; dflt_value: string | null }>;
    const visibilityColumn = columns.find((column) => column.name === "visibility");

    expect(visibilityColumn).toBeDefined();
    expect(visibilityColumn?.dflt_value).toBe("'public'");

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

  it("session_context has FK to sessions after v9 migration", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const fks = db
      .prepare("PRAGMA foreign_key_list(session_context)")
      .all() as Array<{ table: string; from: string; to: string }>;

    const sessionFk = fks.find((fk) => fk.from === "session_id");
    expect(sessionFk).toBeDefined();
    expect(sessionFk!.table).toBe("sessions");
    expect(sessionFk!.to).toBe("id");

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

  it("chunks table has file and hash indexes (v11)", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const indexes = db
      .prepare("PRAGMA index_list(chunks)")
      .all() as Array<{ name: string }>;

    expect(indexes.some((idx) => idx.name === "idx_chunks_file")).toBe(true);
    expect(indexes.some((idx) => idx.name === "idx_chunks_hash")).toBe(true);

    db.close();
  });

  it("chunk_embeddings table exists with chunk_id uniqueness after v12", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const columns = db.prepare("PRAGMA table_info(chunk_embeddings)").all() as Array<{ name: string; pk: number }>;
    expect(columns.some((column) => column.name === "chunk_id" && column.pk === 1)).toBe(true);
    expect(columns.some((column) => column.name === "embedding")).toBe(true);

    db.close();
  });

  it("v16 converts absolute file paths to project-relative paths", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = OFF");

    // Apply all migrations up to v15, then mark v16 as already applied so it is skipped.
    runMigrations(db);

    // Re-open state: remove v16 from schema_migrations so it runs again.
    db.prepare("DELETE FROM schema_migrations WHERE version = 16").run();

    // Insert absolute-path files simulating a pre-v16 database.
    const now = Date.now();
    const projectRoot = "/Users/dev/project";
    db.prepare(
      "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(`${projectRoot}/src/main.ts`, "main.ts", "abc", now, now, "typescript", 3, null);
    db.prepare(
      "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(`${projectRoot}/src/utils/helpers.ts`, "helpers.ts", "def", now, now, "typescript", 1, null);
    db.prepare(
      "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(`${projectRoot}/README.md`, "README.md", "ghi", now, now, "markdown", 0, null);

    // Insert a session with project_root so v16 knows which prefix to strip.
    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("migration-test-session", "claude-code", projectRoot, now - 1000);

    // Apply v16.
    runMigrations(db);

    const files = db
      .prepare("SELECT path FROM files ORDER BY path")
      .all() as Array<{ path: string }>;
    const paths = files.map((f) => f.path);

    expect(paths).toContain("README.md");
    expect(paths).toContain("src/main.ts");
    expect(paths).toContain("src/utils/helpers.ts");
    // Verify no absolute paths remain.
    expect(paths.every((p) => !p.startsWith("/"))).toBe(true);

    db.close();
  });

  it("v10 clears file_summaries so backfill re-runs with updated buildSummaryText", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    runMigrations(db);

    const now = Date.now();
    db.prepare(
      "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("src/test.ts", "abc", now, now, "typescript", 0, null);
    db.prepare(
      "INSERT INTO file_summaries (file_id, export_names, symbol_count, edge_count, avg_centrality, summary_text, computed_at) VALUES (1, '', 0, 0, 0.0, 'old summary', ?)"
    ).run(now);

    const countBefore = (
      db.prepare("SELECT COUNT(*) as c FROM file_summaries").get() as { c: number }
    ).c;
    expect(countBefore).toBe(1);

    db.exec("DELETE FROM file_summaries");

    const countAfter = (
      db.prepare("SELECT COUNT(*) as c FROM file_summaries").get() as { c: number }
    ).c;
    expect(countAfter).toBe(0);

    db.close();
  });
});
