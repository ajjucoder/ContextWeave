import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { BM25Index } from "../../src/memory/bm25.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { runMigrations } from "../../src/db/migrations.js";

let db: Database.Database;
let bm25: BM25Index;

function createObservation(id: number): number {
  const queries = observationQueries(db);
  return queries.insert({
    sessionId: "test",
    agentId: "test",
    symbolId: null,
    fileId: null,
    scope: "test",
    note: `obs-${id}`,
    confidence: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stale: false,
    staleReason: null,
    archived: false,
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES ('test', 'test', '/tmp', ?)").run(Date.now());
  bm25 = new BM25Index(db);
});

afterEach(() => {
  db.close();
});

describe("BM25 correctness", () => {
  it("stores raw term frequencies, not pre-normalized", () => {
    const obsId = createObservation(1);
    bm25.indexObservation(obsId, "hello world hello");

    const rows = db.prepare("SELECT term, tf FROM bm25_index WHERE observation_id = ?").all(obsId) as Array<{ term: string; tf: number }>;
    const helloRow = rows.find((r) => r.term === "hello");
    const worldRow = rows.find((r) => r.term === "world");

    expect(helloRow?.tf).toBe(2);
    expect(worldRow?.tf).toBe(1);
  });

  it("tracks document lengths separately", () => {
    const obsId = createObservation(1);
    bm25.indexObservation(obsId, "one two three");

    const dlRow = db.prepare("SELECT dl FROM bm25_doc_lengths WHERE observation_id = ?").get(obsId) as { dl: number } | undefined;
    expect(dlRow?.dl).toBe(3);
  });

  it("maintains correct avgdl across insertions", () => {
    const obs1 = createObservation(1);
    const obs2 = createObservation(2);
    bm25.indexObservation(obs1, "one two three");
    bm25.indexObservation(obs2, "four five six seven eight");

    const avgdl = parseFloat(
      (db.prepare("SELECT value FROM bm25_stats WHERE key = 'avg_dl'").get() as { value: string }).value
    );

    expect(avgdl).toBeCloseTo((3 + 5) / 2, 5);
  });

  it("maintains correct avgdl after removal", () => {
    const obs1 = createObservation(1);
    const obs2 = createObservation(2);
    bm25.indexObservation(obs1, "one two three");
    bm25.indexObservation(obs2, "four five six seven eight");
    bm25.removeObservation(obs1);

    const docCount = parseFloat(
      (db.prepare("SELECT value FROM bm25_stats WHERE key = 'doc_count'").get() as { value: string }).value
    );
    const avgdl = parseFloat(
      (db.prepare("SELECT value FROM bm25_stats WHERE key = 'avg_dl'").get() as { value: string }).value
    );

    expect(docCount).toBe(1);
    expect(avgdl).toBeCloseTo(5, 5);
  });

  it("does not drift avgdl with repeated add/remove cycles", () => {
    const ids: number[] = [];
    for (let i = 1; i <= 10; i++) {
      ids.push(createObservation(i));
    }
    for (const id of ids) {
      bm25.indexObservation(id, "consistent length text here now");
    }
    for (let i = 0; i < 5; i++) {
      bm25.removeObservation(ids[i]!);
    }

    const avgdl = parseFloat(
      (db.prepare("SELECT value FROM bm25_stats WHERE key = 'avg_dl'").get() as { value: string }).value
    );

    expect(avgdl).toBeCloseTo(5, 1);
  });

  it("ranks exact term matches higher than partial matches", () => {
    const obs1 = createObservation(1);
    const obs2 = createObservation(2);
    const obs3 = createObservation(3);
    bm25.indexObservation(obs1, "authentication login security");
    bm25.indexObservation(obs2, "database connection pooling");
    bm25.indexObservation(obs3, "authentication token refresh");

    const results = bm25.search("authentication");
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.observationId);
    expect(ids).toContain(obs1);
    expect(ids).toContain(obs3);
    expect(ids).not.toContain(obs2);
  });

  it("returns empty results for stopwords-only queries", () => {
    const obsId = createObservation(1);
    bm25.indexObservation(obsId, "quick brown fox");
    const results = bm25.search("the a an is");
    expect(results.length).toBe(0);
  });

  it("handles rebuildStats correctly", () => {
    const obs1 = createObservation(1);
    const obs2 = createObservation(2);
    bm25.indexObservation(obs1, "one two three");
    bm25.indexObservation(obs2, "four five");

    bm25.rebuildStats();

    const docCount = parseFloat(
      (db.prepare("SELECT value FROM bm25_stats WHERE key = 'doc_count'").get() as { value: string }).value
    );
    const avgdl = parseFloat(
      (db.prepare("SELECT value FROM bm25_stats WHERE key = 'avg_dl'").get() as { value: string }).value
    );

    expect(docCount).toBe(2);
    expect(avgdl).toBeCloseTo(2.5, 5);
  });
});
