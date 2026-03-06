import { describe, it, expect, beforeAll, afterAll } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import type Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { weightedBfsTraversal } from "../../src/core/weighted-bfs.js";

describe("weighted BFS direction control", () => {
  let db: Database.Database;
  let symA: number, symB: number, symC: number, symD: number;

  beforeAll(() => {
    db = new DatabaseConstructor(":memory:");
    runMigrations(db);

    // Create files
    db.prepare("INSERT INTO files (path, basename, hash, last_indexed, mtime, language) VALUES (?, ?, ?, ?, ?, ?)").run("src/a.ts", "a.ts", "h1", Date.now(), Date.now(), "typescript");
    db.prepare("INSERT INTO files (path, basename, hash, last_indexed, mtime, language) VALUES (?, ?, ?, ?, ?, ?)").run("src/b.ts", "b.ts", "h2", Date.now(), Date.now(), "typescript");

    const fileA = (db.prepare("SELECT id FROM files WHERE path = 'src/a.ts'").get() as any).id;
    const fileB = (db.prepare("SELECT id FROM files WHERE path = 'src/b.ts'").get() as any).id;

    // Create symbols: A calls B, B calls C, D calls A
    // Graph: D → A → B → C
    const insert = db.prepare("INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run(fileA, "funcA", "function", 1, 10, "funcA()", "ha", "function funcA() {}", 1, 1);
    insert.run(fileA, "funcB", "function", 15, 25, "funcB()", "hb", "function funcB() {}", 1, 1);
    insert.run(fileB, "funcC", "function", 1, 10, "funcC()", "hc", "function funcC() {}", 1, 1);
    insert.run(fileB, "funcD", "function", 15, 25, "funcD()", "hd", "function funcD() {}", 1, 1);

    symA = (db.prepare("SELECT id FROM symbols WHERE name = 'funcA'").get() as any).id;
    symB = (db.prepare("SELECT id FROM symbols WHERE name = 'funcB'").get() as any).id;
    symC = (db.prepare("SELECT id FROM symbols WHERE name = 'funcC'").get() as any).id;
    symD = (db.prepare("SELECT id FROM symbols WHERE name = 'funcD'").get() as any).id;

    // Edges: A→B (call), B→C (call), D→A (call)
    const edgeInsert = db.prepare("INSERT INTO edges (source_symbol_id, target_symbol_id, kind, created_at) VALUES (?, ?, ?, ?)");
    edgeInsert.run(symA, symB, "call", Date.now());
    edgeInsert.run(symB, symC, "call", Date.now());
    edgeInsert.run(symD, symA, "call", Date.now());
  });

  afterAll(() => db.close());

  it("outgoing from A finds B and C but not D", () => {
    const result = weightedBfsTraversal(db, [symA], 10, null, { direction: "outgoing" });
    const ids = result.map((n) => n.symbolId);
    expect(ids).toContain(symB);
    expect(ids).toContain(symC);
    expect(ids).not.toContain(symD);
  });

  it("incoming from A finds D but not B or C", () => {
    const result = weightedBfsTraversal(db, [symA], 10, null, { direction: "incoming" });
    const ids = result.map((n) => n.symbolId);
    expect(ids).toContain(symD);
    expect(ids).not.toContain(symB);
    expect(ids).not.toContain(symC);
  });

  it("both from A finds B, C, and D", () => {
    const result = weightedBfsTraversal(db, [symA], 10, null, { direction: "both" });
    const ids = result.map((n) => n.symbolId);
    expect(ids).toContain(symB);
    expect(ids).toContain(symC);
    expect(ids).toContain(symD);
  });

  it("default direction is both", () => {
    const result = weightedBfsTraversal(db, [symA], 10, null, {});
    const ids = result.map((n) => n.symbolId);
    expect(ids).toContain(symB);
    expect(ids).toContain(symD);
  });
});
