import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { BM25Index } from "../../src/memory/bm25.js";
import { MemorySearch } from "../../src/memory/search.js";

let db: Database.Database;

function insertObservation(
  queries: ReturnType<typeof observationQueries>,
  bm25: BM25Index,
  note: string,
  confidence = 1
): void {
  const now = Date.now();
  const id = queries.insert({
    sessionId: "s1",
    agentId: "a1",
    symbolId: null,
    fileId: null,
    scope: "architecture",
    note,
    confidence,
    createdAt: now,
    updatedAt: now,
    stale: false,
    staleReason: null,
    archived: false,
  });
  bm25.indexObservation(id, `${note} architecture`);
}

beforeAll(() => {
  db = new Database(":memory:");
  runMigrations(db);
  db.prepare(
    "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run("s1", "a1", "/tmp", Date.now());

  const queries = observationQueries(db);
  const bm25 = new BM25Index(db);

  insertObservation(queries, bm25, "middleware middleware cache boundary");
  insertObservation(queries, bm25, "authentication middleware login flow");
  insertObservation(queries, bm25, "authentication middleware session guard");
  insertObservation(queries, bm25, "authentication middleware cookie validation");
  insertObservation(queries, bm25, "middleware rate limit chain");
});

afterAll(() => {
  db.close();
});

describe("MemorySearch reciprocal rank fusion", () => {
  it("promotes observations supported by both Porter and trigram signals", () => {
    const search = new MemorySearch(db);

    const results = search.search("authentiction middleware", { limit: 3 });

    expect(results[0]?.observation.note).toBe("authentication middleware login flow");
  });

  it("keeps trigram-corrected matches in the merged result set even when porter results are plentiful", () => {
    const search = new MemorySearch(db);

    const results = search.search("authentiction middleware", { limit: 3 });
    const notes = results.map((result) => result.observation.note);

    expect(notes).toContain("middleware middleware cache boundary");
  });
});
