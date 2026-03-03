import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { countStaleFiles } from "../../src/db/queries/files.js";

function seedDb(db: Database.Database): void {
  createSchema(db);
  // stale: mtime(1000) > last_indexed(900)
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/a.ts', 'h1', 900, 1000, 'typescript')"
  ).run();
  // fresh: mtime(800) < last_indexed(900)
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/b.ts', 'h2', 900, 800, 'typescript')"
  ).run();
  // stale: mtime(950) > last_indexed(900)
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/c.ts', 'h3', 900, 950, 'typescript')"
  ).run();
}

describe("countStaleFiles", () => {
  it("counts files where mtime > last_indexed", () => {
    const db = new Database(":memory:");
    seedDb(db);
    expect(countStaleFiles(db)).toBe(2);
  });

  it("returns 0 when no stale files", () => {
    const db = new Database(":memory:");
    createSchema(db);
    db.prepare(
      "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/a.ts', 'h1', 900, 800, 'typescript')"
    ).run();
    expect(countStaleFiles(db)).toBe(0);
  });
});
