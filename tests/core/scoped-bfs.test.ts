import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { scopedLazyBfsTraversal } from "../../src/core/graph.js";

function seedTwoDirs(db: Database.Database): { sa: number; sb: number } {
  const now = Date.now();

  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count) VALUES ('/src/a/a.ts', '', 0, 0, 'typescript', 1)"
  ).run();
  const fa = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count) VALUES ('/src/b/b.ts', '', 0, 0, 'typescript', 1)"
  ).run();
  const fb = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, 'A', 'function', 1, 2, 'A', '', '', 1, 0, ?)"
  ).run(fa, now);
  const sa = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, 'B', 'function', 1, 2, 'B', '', '', 1, 0, ?)"
  ).run(fb, now);
  const sb = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare("INSERT INTO edges (source_symbol_id, target_symbol_id, kind, created_at) VALUES (?, ?, 'call', ?)").run(sa, sb, now);
  return { sa, sb };
}

describe("scopedLazyBfsTraversal", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("stops at directory boundary when scoped", () => {
    const { sa, sb } = seedTwoDirs(db);
    const results = scopedLazyBfsTraversal(db, [sa], 5, ["/src/a"]);
    const ids = results.map((r) => r.symbolId);
    expect(ids).toContain(sa);
    expect(ids).not.toContain(sb);
  });

  it("crosses directory boundary when unscoped", () => {
    const { sa, sb } = seedTwoDirs(db);
    const results = scopedLazyBfsTraversal(db, [sa], 5, null);
    const ids = results.map((r) => r.symbolId);
    expect(ids).toContain(sa);
    expect(ids).toContain(sb);
  });
});
