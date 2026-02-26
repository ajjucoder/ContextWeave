import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { lazyBfsTraversal } from "../../src/core/graph.js";

function seed(db: Database.Database): { a: number; b: number; c: number } {
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count) VALUES ('/a.ts', '', 0, 0, 'typescript', 3)"
  ).run();
  const fid = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  const now = Date.now();

  db.prepare(
    "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, 'A', 'function', 1, 2, 'A', '', '', 1, 0, ?)"
  ).run(fid, now);
  const a = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, 'B', 'function', 3, 4, 'B', '', '', 1, 0, ?)"
  ).run(fid, now);
  const b = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, 'C', 'function', 5, 6, 'C', '', '', 1, 0, ?)"
  ).run(fid, now);
  const c = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

  const now2 = Date.now();
  db.prepare("INSERT INTO edges (source_symbol_id, target_symbol_id, kind, created_at) VALUES (?, ?, 'call', ?)")
    .run(a, b, now2);
  db.prepare("INSERT INTO edges (source_symbol_id, target_symbol_id, kind, created_at) VALUES (?, ?, 'call', ?)")
    .run(b, c, now2);

  return { a, b, c };
}

describe("lazyBfsTraversal", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("traverses a -> b -> c starting from a", () => {
    const { a, b, c } = seed(db);
    const results = lazyBfsTraversal(db, [a], 3);
    const ids = results.map((r) => r.symbolId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).toContain(c);
  });

  it("respects maxDepth", () => {
    const { a, c } = seed(db);
    const results = lazyBfsTraversal(db, [a], 1);
    const ids = results.map((r) => r.symbolId);
    expect(ids).toContain(a);
    expect(ids).not.toContain(c);
  });

  it("returns correct distances", () => {
    const { a, b } = seed(db);
    const results = lazyBfsTraversal(db, [a], 2);
    const bNode = results.find((r) => r.symbolId === b);
    expect(bNode?.distance).toBe(1);
  });
});
