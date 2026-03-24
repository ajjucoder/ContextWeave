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
      scope: "passive",
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observation.note).toContain("UserService authentication");
  });

  it("captureQueryObservation skips duplicate passive observations", () => {
    const symbols = symbolQueries(db);
    const allSyms = symbols.getAll();
    const pivotIds = new Set(allSyms.slice(0, 3).map((s) => s.id));
    const query = "UserService authentication dedup";
    const note = `[auto] Query: "${query}" resolved to: ${allSyms.slice(0, 3).map((s) => s.name).join(", ")}`;
    const before = (db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE scope = ? AND note = ? AND archived = 0"
    ).get("passive", note) as { count: number }).count;

    captureQueryObservation(db, query, pivotIds, "test-session", FIXTURE_DIR);
    captureQueryObservation(db, query, pivotIds, "test-session", FIXTURE_DIR);

    const row = db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE scope = ? AND note = ? AND archived = 0"
    ).get("passive", note) as {
      count: number;
    };

    expect(row.count - before).toBe(1);
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
    const results = search.search("newHelper", { scope: "passive", limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observation.note).toContain("newHelper");
  });

  it("captureFileChangeObservation skips duplicate passive observations", () => {
    const filePath = resolve(FIXTURE_DIR, "service.ts");
    const note = "[auto] Modified: service.ts — added: [dedupHelper], removed: [], changed: []";
    const diff = {
      added: [{ name: "dedupHelper", kind: "function", startLine: 1, endLine: 5, signature: "", bodyHash: "", fullSource: "", isExported: true, docComment: null }],
      deleted: [],
      modified: [],
      renamed: [],
      unchanged: [],
    };
    const before = (db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE scope = ? AND note = ? AND archived = 0"
    ).get("passive", note) as { count: number }).count;

    captureFileChangeObservation(db, filePath, diff, 1, "test-session", FIXTURE_DIR);
    captureFileChangeObservation(db, filePath, diff, 1, "test-session", FIXTURE_DIR);

    const row = db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE scope = ? AND note = ? AND archived = 0"
    ).get("passive", note) as { count: number };

    expect(row.count - before).toBe(1);
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

  it("generateCapsule excludes passive observations by default", () => {
    const store = new ObservationStore(db);
    store.create({
      sessionId: "test-session",
      scope: "architecture",
      note: "Architecture note: UserService coordinates authentication state.",
      confidence: 1.0,
    });

    const symbols = symbolQueries(db);
    const pivotIds = new Set(symbols.getAll().slice(0, 2).map((s) => s.id));
    captureQueryObservation(db, "UserService authentication", pivotIds, "test-session", FIXTURE_DIR);

    const result = generateCapsule(db, {
      query: "UserService authentication",
      tokenBudget: 1200,
      sessionId: "test-session",
      projectRoot: FIXTURE_DIR,
    });

    expect(result.content).toContain("Architecture note: UserService coordinates authentication state.");
    expect(result.content).not.toContain('[auto] Query: "UserService authentication"');
  });
});
