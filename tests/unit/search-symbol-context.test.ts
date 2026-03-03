import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { getEnclosingSymbol } from "../../src/db/queries/symbols.js";

function seedDb(db: Database.Database): void {
  createSchema(db);
  db.prepare(
    "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/utils/toast.ts', 'h1', 1, 1, 'typescript')"
  ).run();
  const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/utils/toast.ts'").get() as { id: number }).id;
  db.prepare(
    `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, last_seen)
     VALUES (?, 'showToast', 'function', 10, 30, 'function showToast()', 'h1', '', 1, 1)`
  ).run(fileId);
}

describe("getEnclosingSymbol", () => {
  it("returns the symbol that contains a given line", () => {
    const db = new Database(":memory:");
    seedDb(db);
    const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/utils/toast.ts'").get() as { id: number }).id;
    const sym = getEnclosingSymbol(db, fileId, 15);
    expect(sym?.name).toBe("showToast");
    expect(sym?.kind).toBe("function");
  });

  it("returns null for line before any symbol", () => {
    const db = new Database(":memory:");
    seedDb(db);
    const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/utils/toast.ts'").get() as { id: number }).id;
    const sym = getEnclosingSymbol(db, fileId, 5);
    expect(sym).toBeNull();
  });

  it("returns null for line after all symbols", () => {
    const db = new Database(":memory:");
    seedDb(db);
    const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/utils/toast.ts'").get() as { id: number }).id;
    const sym = getEnclosingSymbol(db, fileId, 50);
    expect(sym).toBeNull();
  });

  it("prefers narrowest enclosing symbol when nested", () => {
    const db = new Database(":memory:");
    createSchema(db);
    db.prepare(
      "INSERT INTO files (path, hash, last_indexed, mtime, language) VALUES ('src/a.ts', 'h2', 1, 1, 'typescript')"
    ).run();
    const fileId = (db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as { id: number }).id;
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, last_seen)
       VALUES (?, 'outerClass', 'class', 1, 100, 'class outerClass', 'h2', '', 1, 1)`
    ).run(fileId);
    db.prepare(
      `INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, last_seen)
       VALUES (?, 'innerMethod', 'method', 10, 20, 'innerMethod()', 'h3', '', 1, 1)`
    ).run(fileId);
    const sym = getEnclosingSymbol(db, fileId, 15);
    expect(sym?.name).toBe("innerMethod");
  });
});
