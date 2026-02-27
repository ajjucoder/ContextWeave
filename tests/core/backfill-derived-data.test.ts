import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { backfillSummariesIfNeeded } from "../../src/core/file-summaries.js";
import { backfillClustersIfNeeded } from "../../src/core/clusters.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => db?.close());

function insertFakeFile(id: number, path: string): void {
  db.prepare(
    "INSERT INTO files (id, path, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, path, `h-${id}`, Date.now(), Date.now(), "typescript", 2, null);
}

function insertFakeSymbol(id: number, fileId: number, name: string): void {
  db.prepare(
    "INSERT INTO symbols (id, file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, fileId, name, "function", 1, 10, `function ${name}()`, `bh-${id}`, `function ${name}() {}`, 1, null, 0.01, Date.now());
}

describe("backfill derived data for legacy DBs", () => {
  it("backfills file_summaries when files exist but summaries are empty", () => {
    insertFakeFile(1, "src/foo.ts");
    insertFakeFile(2, "src/bar.ts");
    insertFakeSymbol(1, 1, "foo");
    insertFakeSymbol(2, 2, "bar");

    const summaryCount = (db.prepare("SELECT COUNT(*) as c FROM file_summaries").get() as { c: number }).c;
    expect(summaryCount).toBe(0);

    const backfilled = backfillSummariesIfNeeded(db);
    expect(backfilled).toBe(true);

    const afterCount = (db.prepare("SELECT COUNT(*) as c FROM file_summaries").get() as { c: number }).c;
    expect(afterCount).toBe(2);
  });

  it("does not backfill when summaries already exist", () => {
    insertFakeFile(1, "src/foo.ts");
    insertFakeSymbol(1, 1, "foo");

    backfillSummariesIfNeeded(db);
    const backfilledAgain = backfillSummariesIfNeeded(db);
    expect(backfilledAgain).toBe(false);
  });

  it("backfills file_clusters when files exist but clusters are empty", () => {
    insertFakeFile(1, "src/a.ts");
    insertFakeFile(2, "src/b.ts");
    insertFakeSymbol(1, 1, "a");
    insertFakeSymbol(2, 2, "b");

    const clusterCount = (db.prepare("SELECT COUNT(*) as c FROM file_clusters").get() as { c: number }).c;
    expect(clusterCount).toBe(0);

    const backfilled = backfillClustersIfNeeded(db);
    expect(backfilled).toBe(true);

    const afterCount = (db.prepare("SELECT COUNT(*) as c FROM file_clusters").get() as { c: number }).c;
    expect(afterCount).toBeGreaterThan(0);
  });

  it("does not backfill clusters when clusters already exist", () => {
    insertFakeFile(1, "src/a.ts");
    insertFakeSymbol(1, 1, "a");

    backfillClustersIfNeeded(db);
    const backfilledAgain = backfillClustersIfNeeded(db);
    expect(backfilledAgain).toBe(false);
  });

  it("returns false when no files exist", () => {
    expect(backfillSummariesIfNeeded(db)).toBe(false);
    expect(backfillClustersIfNeeded(db)).toBe(false);
  });
});
