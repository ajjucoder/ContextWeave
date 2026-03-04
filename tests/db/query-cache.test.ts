import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

describe("query statement caching", () => {
  it("symbolQueries returns same object for same db", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const a = symbolQueries(db);
    const b = symbolQueries(db);
    expect(a).toBe(b);
    db.close();
  });

  it("fileQueries returns same object for same db", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const a = fileQueries(db);
    const b = fileQueries(db);
    expect(a).toBe(b);
    db.close();
  });

  it("edgeQueries returns same object for same db", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const a = edgeQueries(db);
    const b = edgeQueries(db);
    expect(a).toBe(b);
    db.close();
  });

  it("symbolQueries returns different objects for different db instances", () => {
    const db1 = new Database(":memory:");
    const db2 = new Database(":memory:");
    runMigrations(db1);
    runMigrations(db2);
    const a = symbolQueries(db1);
    const b = symbolQueries(db2);
    expect(a).not.toBe(b);
    db1.close();
    db2.close();
  });
});
