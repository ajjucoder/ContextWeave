import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

describe("symbolQueries.getByIdLight", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);

    db.prepare(
      "INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count) VALUES ('/a.ts', '', 0, 0, 'typescript', 1)"
    ).run();
    const fileId = (db.prepare("SELECT last_insert_rowid() as id").get() as { id: number }).id;

    db.prepare(
      "INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, centrality, last_seen) VALUES (?, 'myFn', 'function', 1, 50, 'myFn(): void', 'abc', 'BIG_SOURCE_BLOB_OMITTED', 1, 0.5, 0)"
    ).run(fileId);
  });

  it("returns light symbol without fullSource", () => {
    const queries = symbolQueries(db);
    const id = queries.getAllIds()[0]!;
    const light = queries.getByIdLight(id);

    expect(light).toBeTruthy();
    expect(light?.name).toBe("myFn");
    expect((light as unknown as { fullSource?: string }).fullSource).toBeUndefined();
  });

  it("returns full symbol with fullSource from getById", () => {
    const queries = symbolQueries(db);
    const id = queries.getAllIds()[0]!;
    const full = queries.getById(id);
    expect(full?.fullSource).toBe("BIG_SOURCE_BLOB_OMITTED");
  });
});
