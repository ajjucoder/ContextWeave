import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { MemorySearch } from "../../src/memory/search.js";
import { ObservationStore } from "../../src/memory/observations.js";
import { captureQueryObservation, captureFileChangeObservation } from "../../src/memory/passive.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

let db: Database.Database;
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare("INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES ('test-session', 'test', ?, ?)").run(FIXTURE_DIR, Date.now());

  await indexProject(db, FIXTURE_DIR);
});

afterAll(() => {
  db.close();
});

describe("passive observations are searchable via recall", () => {
  it("captureQueryObservation creates an observation findable by BM25", () => {
    const symbols = symbolQueries(db);
    const allSyms = symbols.getAll();
    const pivotIds = new Set(allSyms.slice(0, 3).map((s) => s.id));

    captureQueryObservation(db, "UserService authentication", pivotIds, "test-session", FIXTURE_DIR);

    const search = new MemorySearch(db);
    const results = search.search("UserService authentication", {
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observation.note).toContain("UserService authentication");
  });

  it("captureFileChangeObservation creates an observation findable by BM25", () => {
    captureFileChangeObservation(
      db,
      resolve(FIXTURE_DIR, "service.ts"),
      {
        added: [{ name: "newHelper", kind: "function", startLine: 1, endLine: 5, signature: "", bodyHash: "", fullSource: "", isExported: true, docComment: null }],
        deleted: [],
        modified: [],
        renamed: [],
        unchanged: [],
      },
      1,
      "test-session",
      FIXTURE_DIR
    );

    const search = new MemorySearch(db);
    const results = search.search("newHelper", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observation.note).toContain("newHelper");
  });

  it("ObservationStore.create produces BM25-searchable results", () => {
    const store = new ObservationStore(db);
    store.create({
      sessionId: "test-session",
      scope: "architecture",
      note: "The payment gateway uses Stripe webhooks for async processing",
    });

    const search = new MemorySearch(db);
    const results = search.search("stripe payment webhook", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observation.note).toContain("Stripe webhooks");
  });
});
