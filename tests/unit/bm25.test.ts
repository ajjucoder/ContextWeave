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

describe("BM25 stemmed search", () => {
  it("matches morphological variants via stemming", () => {
    createObservation(db, 1);
    createObservation(db, 2);

    bm25.indexObservation(1, "caching strategy for database connections");
    bm25.indexObservation(2, "logging configuration for production");

    const results = bm25.search("cached connection");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observationId).toBe(1);
  });

  it("matches -tion/-ing variants", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "authentication middleware validates tokens");

    const results = bm25.search("authenticating");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observationId).toBe(1);
  });
});

describe("BM25 searchWithFallback", () => {
  it("returns stemmed results without triggering fallback when enough matches exist", () => {
    createObservation(db, 1);
    createObservation(db, 2);
    createObservation(db, 3);

    bm25.indexObservation(1, "authentication middleware handler");
    bm25.indexObservation(2, "authentication token refresh logic");
    bm25.indexObservation(3, "database connection pooling setup");

    const results = bm25.searchWithFallback("authentication", 10, 2);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.observationId);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("falls back to trigram matching on partial terms", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "kubernetes deployment configuration");

    const results = bm25.searchWithFallback("kubernet", 10, 1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.observationId).toBe(1);
  });

  it("falls back to Levenshtein correction on typos", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "kubernetes cluster management");

    const results = bm25.searchWithFallback("kuberntes", 10, 1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.observationId).toBe(1);
  });

  it("returns empty for completely unrelated queries", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "authentication middleware");

    const results = bm25.searchWithFallback("zzzznotfound", 10, 1);
    expect(results).toHaveLength(0);
  });
});
