import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

function seedSymbol(db: Database.Database, name: string, kind = "function"): void {
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count) VALUES (?, '', 0, 0, 'typescript', 1)"
  ).run(`/fake/${name}.ts`);
  const fileId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;
  db.prepare(
    "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, ?, ?, 1, 10, ?, '', '', 1, 0, 0)"
  ).run(fileId, name, kind, name);
}

describe("symbolQueries.searchFTS", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    seedSymbol(db, "generateCapsule");
    seedSymbol(db, "capsuleFormatter");
    seedSymbol(db, "buildAdjacencyMap");
    seedSymbol(db, "indexProject");
  });

  it("finds exact name match", () => {
    const q = symbolQueries(db);
    const results = q.searchFTS("generateCapsule", 10);
    expect(results.map((r) => r.name)).toContain("generateCapsule");
  });

  it("finds substring match via trigram", () => {
    const q = symbolQueries(db);
    const results = q.searchFTS("capsule", 10);
    const names = results.map((r) => r.name);
    expect(names).toContain("generateCapsule");
    expect(names).toContain("capsuleFormatter");
  });

  it("returns empty for no match", () => {
    const q = symbolQueries(db);
    const results = q.searchFTS("zzznomatch", 10);
    expect(results).toHaveLength(0);
  });

  it("respects limit", () => {
    const q = symbolQueries(db);
    const results = q.searchFTS("e", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
