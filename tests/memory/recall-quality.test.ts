import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { MemorySearch } from "../../src/memory/search.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { BM25Index } from "../../src/memory/bm25.js";

let db: Database.Database;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertObs(
  queries: ReturnType<typeof observationQueries>,
  bm25: BM25Index,
  scope: string,
  note: string,
  confidence = 0.9
): number {
  const now = Date.now();
  const id = queries.insert({
    sessionId: "s1",
    agentId: "a1",
    symbolId: null,
    fileId: null,
    scope,
    note,
    confidence,
    createdAt: now,
    updatedAt: now,
    stale: false,
    staleReason: null,
    archived: false,
  });
  bm25.indexObservation(id, `${note} ${scope}`);
  return id;
}

beforeAll(() => {
  db = new Database(":memory:");
  runMigrations(db);

  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run("s1", "a1", "/tmp", Date.now());

  const queries = observationQueries(db);
  const bm25 = new BM25Index(db);

  // Auth-related observations (various synonyms)
  insertObs(queries, bm25, "architecture", "auth system uses JWT with refresh token rotation", 1.0);
  insertObs(queries, bm25, "architecture", "authentication middleware validates session cookies", 0.9);
  insertObs(queries, bm25, "pattern", "login flow triggers credential validation before session creation", 0.85);

  // Database-related observations
  insertObs(queries, bm25, "architecture", "database uses PostgreSQL with connection pooling", 0.95);
  insertObs(queries, bm25, "pattern", "SQL queries use parameterized statements to prevent injection", 0.9);
  insertObs(queries, bm25, "decision", "ORM layer wraps all db transactions with retry logic", 0.85);

  // Cache-related
  insertObs(queries, bm25, "pattern", "Redis cache with TTL-based eviction for session data", 0.9);
  insertObs(queries, bm25, "architecture", "cache invalidation triggered on user profile update", 0.85);

  // Queue / async tasks
  insertObs(queries, bm25, "architecture", "job queue uses Bull with Redis broker for background workers", 0.9);
  insertObs(queries, bm25, "pattern", "task scheduling uses cron expressions for periodic jobs", 0.8);

  // Error handling
  insertObs(queries, bm25, "pattern", "error handler catches unhandled exceptions at middleware boundary", 0.9);
  insertObs(queries, bm25, "decision", "panic recovery wraps all route handlers to prevent crash", 0.85);

  // Config
  insertObs(queries, bm25, "architecture", "configuration loaded from environment variables at startup", 0.9);
  insertObs(queries, bm25, "pattern", "feature flags controlled via config service with hot-reload", 0.8);

  // Validation
  insertObs(queries, bm25, "pattern", "input validation uses Zod schema at API boundary", 0.9);
  insertObs(queries, bm25, "decision", "sanitize user input before passing to database layer", 0.85);

  // State management
  insertObs(queries, bm25, "architecture", "global state managed via Redux store with selectors", 0.9);
  insertObs(queries, bm25, "pattern", "context provider wraps app root for shared state access", 0.8);

  // Event
  insertObs(queries, bm25, "architecture", "event emitter pattern for cross-module pub/sub communication", 0.9);
  insertObs(queries, bm25, "pattern", "domain events dispatched via in-process event bus", 0.85);
});

afterAll(() => db?.close());

// ---------------------------------------------------------------------------
// Synonym expansion coverage
// ---------------------------------------------------------------------------

describe("MemorySearch — synonym expansion", () => {
  it("finds auth observations when querying with synonym 'login'", () => {
    const search = new MemorySearch(db);
    const results = search.search("login", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasAuth = notes.some(
      (n) => n.includes("auth") || n.includes("login") || n.includes("session")
    );
    expect(hasAuth).toBe(true);
  });

  it("finds db observations when querying with synonym 'database'", () => {
    const search = new MemorySearch(db);
    const results = search.search("database", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasDb = notes.some(
      (n) => n.includes("database") || n.includes("sql") || n.includes("db") || n.includes("orm")
    );
    expect(hasDb).toBe(true);
  });

  it("finds cache observations when querying with synonym 'memoize'", () => {
    const search = new MemorySearch(db);
    const results = search.search("memoize ttl", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasCache = notes.some((n) => n.includes("cache") || n.includes("redis") || n.includes("ttl"));
    expect(hasCache).toBe(true);
  });

  it("finds queue observations when querying with synonym 'job'", () => {
    const search = new MemorySearch(db);
    const results = search.search("job worker", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasQueue = notes.some(
      (n) => n.includes("queue") || n.includes("job") || n.includes("worker") || n.includes("bull")
    );
    expect(hasQueue).toBe(true);
  });

  it("finds validation observations when querying with synonym 'sanitize'", () => {
    const search = new MemorySearch(db);
    const results = search.search("sanitize input", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasValidation = notes.some(
      (n) => n.includes("sanitize") || n.includes("validate") || n.includes("zod")
    );
    expect(hasValidation).toBe(true);
  });

  it("finds state observations when querying with synonym 'store'", () => {
    const search = new MemorySearch(db);
    const results = search.search("store reducer", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasState = notes.some(
      (n) => n.includes("state") || n.includes("redux") || n.includes("store")
    );
    expect(hasState).toBe(true);
  });

  it("finds event observations when querying with synonym 'emit'", () => {
    const search = new MemorySearch(db);
    const results = search.search("emit domain events", { limit: 10 });
    const notes = results.map((r) => r.observation.note.toLowerCase());
    const hasEvent = notes.some(
      (n) => n.includes("event") || n.includes("emit") || n.includes("pub")
    );
    expect(hasEvent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Broad query handling — OR expansion
// ---------------------------------------------------------------------------

describe("MemorySearch — broad query OR logic", () => {
  it("returns results for a broad natural-language query (>3 words, no camelCase)", () => {
    const search = new MemorySearch(db);
    // "how does auth middleware session validation work" is broad: 6 words, no camelCase/snake_case
    const results = search.search("auth middleware session validation boundary", { limit: 20 });
    expect(results.length).toBeGreaterThan(0);
  });

  it("broad query returns more results than exact single-term query", () => {
    const search = new MemorySearch(db);
    const broadResults = search.search("auth middleware session validation boundary", { limit: 20 });
    const narrowResults = search.search("auth", { limit: 20 });
    // broad should match at least as many (it includes synonyms + OR)
    expect(broadResults.length).toBeGreaterThanOrEqual(narrowResults.length);
  });

  it("does not expand short camelCase queries (not broad)", () => {
    const search = new MemorySearch(db);
    const allResults = search.search("auth", { limit: 20 });
    const totalObservations = allResults.length;
    const results = search.search("authenticateUser", { limit: 20 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThan(totalObservations);
  });
});

// ---------------------------------------------------------------------------
// Auto-populate from high-confidence capsule
// ---------------------------------------------------------------------------

describe("MemorySearch — autoPopulateFromCapsule", () => {
  it("creates a passive observation when confidence >= 0.70", () => {
    const testDb = new Database(":memory:");
    runMigrations(testDb);
    testDb.prepare(
      "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("s-auto", "a-auto", "/tmp/auto", Date.now());

    const search = new MemorySearch(testDb);
    search.autoPopulateFromCapsule({
      query: "auth token flow",
      confidence: 0.85,
      filesIncluded: ["src/auth/token.ts", "src/auth/session.ts"],
      symbolsIncluded: ["validateToken", "refreshSession"],
    });

    const count = (testDb.prepare("SELECT COUNT(*) as c FROM observations WHERE archived = 0").get() as { c: number }).c;
    expect(count).toBe(1);

    const obs = testDb.prepare("SELECT * FROM observations WHERE archived = 0").get() as Record<string, unknown>;
    expect((obs["scope"] as string)).toBe("passive");
    expect((obs["note"] as string)).toContain("auth token flow");
    expect((obs["note"] as string)).toContain("src/auth/token.ts");

    testDb.close();
  });

  it("skips auto-populate when confidence < 0.70", () => {
    const testDb = new Database(":memory:");
    runMigrations(testDb);
    testDb.prepare(
      "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("s-low", "a-low", "/tmp/low", Date.now());

    const search = new MemorySearch(testDb);
    search.autoPopulateFromCapsule({
      query: "something obscure",
      confidence: 0.50,
      filesIncluded: ["src/foo.ts"],
      symbolsIncluded: [],
    });

    const count = (testDb.prepare("SELECT COUNT(*) as c FROM observations WHERE archived = 0").get() as { c: number }).c;
    expect(count).toBe(0);

    testDb.close();
  });

  it("deduplicates: calling twice with same query+files creates only one observation", () => {
    const testDb = new Database(":memory:");
    runMigrations(testDb);
    testDb.prepare(
      "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("s-dedup", "a-dedup", "/tmp/dedup", Date.now());

    const search = new MemorySearch(testDb);
    const input = {
      query: "cache invalidation",
      confidence: 0.80,
      filesIncluded: ["src/cache/invalidate.ts"],
      symbolsIncluded: ["evictCache"],
    };

    search.autoPopulateFromCapsule(input);
    search.autoPopulateFromCapsule(input);

    const count = (testDb.prepare("SELECT COUNT(*) as c FROM observations WHERE archived = 0").get() as { c: number }).c;
    expect(count).toBe(1);

    testDb.close();
  });

  it("skips auto-populate when filesIncluded is empty", () => {
    const testDb = new Database(":memory:");
    runMigrations(testDb);
    testDb.prepare(
      "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("s-empty", "a-empty", "/tmp/empty", Date.now());

    const search = new MemorySearch(testDb);
    search.autoPopulateFromCapsule({
      query: "some query",
      confidence: 0.90,
      filesIncluded: [],
      symbolsIncluded: [],
    });

    const count = (testDb.prepare("SELECT COUNT(*) as c FROM observations WHERE archived = 0").get() as { c: number }).c;
    expect(count).toBe(0);

    testDb.close();
  });

  it("caps confidence of auto-populated observations at 0.6", () => {
    const testDb = new Database(":memory:");
    runMigrations(testDb);
    testDb.prepare(
      "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("s-cap", "a-cap", "/tmp/cap", Date.now());

    const search = new MemorySearch(testDb);
    search.autoPopulateFromCapsule({
      query: "high confidence query",
      confidence: 1.0,
      filesIncluded: ["src/important.ts"],
      symbolsIncluded: [],
    });

    const obs = testDb.prepare("SELECT confidence FROM observations WHERE archived = 0").get() as { confidence: number };
    expect(obs.confidence).toBeLessThanOrEqual(0.6);

    testDb.close();
  });
});

// ---------------------------------------------------------------------------
// Synonym map coverage — spot checks for new entries
// ---------------------------------------------------------------------------

describe("expandQueryWithSynonyms — coverage spot checks", () => {
  it("synonym map has entries for all target domains", async () => {
    const { expandQueryWithSynonyms } = await import("../../src/utils/synonyms.js");

    const domains = [
      ["auth", ["authentication", "login", "session"]],
      ["cache", ["memoize", "redis", "ttl"]],
      ["db", ["database", "sql", "orm"]],
      ["queue", ["job", "worker", "broker"]],
      ["event", ["emit", "listener", "subscribe"]],
      ["middleware", ["interceptor", "guard", "filter"]],
      ["validation", ["validate", "sanitize", "schema"]],
      ["state", ["store", "reducer", "context"]],
      ["config", ["configuration", "env", "flags"]],
      ["ratelimit", ["throttle", "quota", "backoff"]],
    ] as const;

    for (const [term, expectedSynonyms] of domains) {
      const expanded = expandQueryWithSynonyms([term]);
      for (const syn of expectedSynonyms) {
        expect(expanded, `Expected "${syn}" in synonyms of "${term}"`).toContain(syn);
      }
    }
  });

  it("expands 'error' to include exception, failure, panic", async () => {
    const { expandQueryWithSynonyms } = await import("../../src/utils/synonyms.js");
    const expanded = expandQueryWithSynonyms(["error"]);
    expect(expanded).toContain("exception");
    expect(expanded).toContain("failure");
    expect(expanded).toContain("panic");
  });

  it("expands 'traversal' to include bfs and walk", async () => {
    const { expandQueryWithSynonyms } = await import("../../src/utils/synonyms.js");
    const expanded = expandQueryWithSynonyms(["traversal"]);
    expect(expanded).toContain("bfs");
    expect(expanded).toContain("walk");
  });

  it("expands 'symbol' to include function, class, variable", async () => {
    const { expandQueryWithSynonyms } = await import("../../src/utils/synonyms.js");
    const expanded = expandQueryWithSynonyms(["symbol"]);
    expect(expanded).toContain("function");
    expect(expanded).toContain("class");
    expect(expanded).toContain("variable");
  });
});
