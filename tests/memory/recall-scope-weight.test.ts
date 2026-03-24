import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { MemorySearch } from "../../src/memory/search.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { BM25Index } from "../../src/memory/bm25.js";

let db: Database.Database;
let projectRoot: string;

beforeAll(() => {
  projectRoot = join(tmpdir(), `memory-search-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(projectRoot, ".contextweave"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".contextweave", "config.json"),
    JSON.stringify({ passiveTtlDays: 14 }),
    "utf8"
  );

  db = new Database(":memory:");
  runMigrations(db);

  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run("s1", "a1", projectRoot, Date.now());

  const queries = observationQueries(db);
  const bm25 = new BM25Index(db);
  const now = Date.now();
  const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;

  const archId = queries.insert({
    sessionId: "s1",
    agentId: "a1",
    symbolId: null,
    fileId: null,
    scope: "architecture",
    note: "auth system uses JWT with refresh token rotation",
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
    stale: false,
    staleReason: null,
    archived: false,
  });
  bm25.indexObservation(archId, "auth system uses JWT with refresh token rotation architecture");

  const passiveId = queries.insert({
    sessionId: "s1",
    agentId: "a1",
    symbolId: null,
    fileId: null,
    scope: "passive",
    note: "auth system uses JWT tokens",
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
    stale: false,
    staleReason: null,
    archived: false,
  });
  bm25.indexObservation(passiveId, "auth system uses JWT tokens passive");

  // Old passive observation (8 days ago) - should be auto-expired
  const oldPassiveId = queries.insert({
    sessionId: "s1",
    agentId: "a1",
    symbolId: null,
    fileId: null,
    scope: "passive",
    note: "JWT configuration details",
    confidence: 1.0,
    createdAt: eightDaysAgo,
    updatedAt: eightDaysAgo,
    stale: false,
    staleReason: null,
    archived: false,
  });
  bm25.indexObservation(oldPassiveId, "JWT configuration details passive");
});

afterAll(() => {
  db?.close();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("MemorySearch scope weighting", () => {
  it("ranks architecture scope above passive scope for same query", () => {
    const search = new MemorySearch(db);
    const results = search.search("auth JWT", { limit: 10 });

    const archResult = results.find((r) => r.observation.scope === "architecture");
    const passiveResult = results.find((r) => r.observation.scope === "passive" && !r.observation.stale);

    expect(archResult).toBeDefined();
    expect(passiveResult).toBeDefined();

    // architecture should rank first (higher score)
    const archIndex = results.indexOf(archResult!);
    const passiveIndex = results.indexOf(passiveResult!);
    expect(archIndex).toBeLessThan(passiveIndex);
  });

  it("respects configured passive TTL from project config", () => {
    const search = new MemorySearch(db);
    const results = search.search("JWT configuration", { limit: 10 });

    const oldPassive = results.find(
      (r) => r.observation.note.includes("JWT configuration")
    );

    expect(oldPassive).toBeDefined();
    expect(oldPassive?.observation.note).toContain("JWT configuration details");
  });
});
