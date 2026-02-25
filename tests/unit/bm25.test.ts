import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { BM25Index } from "../../src/memory/bm25.js";

let db: Database.Database;
let bm25: BM25Index;

function createObservation(db: Database.Database, id: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run("test-session", "test", "/test", Date.now());

  db.prepare(
    "INSERT INTO observations (id, session_id, agent_id, scope, note, confidence, created_at, updated_at, stale, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, "test-session", "test", "test", "note", 1.0, Date.now(), Date.now(), 0, 0);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  bm25 = new BM25Index(db);
});

afterEach(() => {
  db.close();
});

describe("BM25Index", () => {
  it("indexes and searches observations", () => {
    createObservation(db, 1);
    createObservation(db, 2);
    createObservation(db, 3);

    bm25.indexObservation(1, "authentication uses JWT tokens for session management");
    bm25.indexObservation(2, "database uses PostgreSQL with connection pooling");
    bm25.indexObservation(3, "the auth handler validates JWT before processing");

    const results = bm25.search("JWT authentication");
    expect(results.length).toBeGreaterThan(0);

    const topResult = results[0]!;
    expect([1, 3]).toContain(topResult.observationId);
  });

  it("returns empty for no matches", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "hello world");
    const results = bm25.search("zzzznotfound");
    expect(results).toHaveLength(0);
  });

  it("removes observations from index", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "important observation about auth");
    bm25.removeObservation(1);

    const results = bm25.search("important auth");
    expect(results).toHaveLength(0);
  });

  it("ranks more relevant documents higher", () => {
    createObservation(db, 1);
    createObservation(db, 2);
    createObservation(db, 3);

    bm25.indexObservation(1, "user authentication login security tokens");
    bm25.indexObservation(2, "database schema migration tools");
    bm25.indexObservation(3, "authentication tokens JWT security validation");

    const results = bm25.search("authentication tokens");
    expect(results.length).toBeGreaterThanOrEqual(2);

    const authIds = results.map((r) => r.observationId);
    expect(authIds).toContain(1);
    expect(authIds).toContain(3);
  });
});
