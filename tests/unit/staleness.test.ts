import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { StalenessEngine } from "../../src/memory/staleness.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { fileQueries } from "../../src/db/queries/files.js";
import type { IndexDiff, SymbolRecord } from "../../src/core/types.js";

function seedDb(db: Database.Database) {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const obs = observationQueries(db);

  const fileId = files.insert({
    path: "src/foo.ts",
    basename: "foo.ts",
    hash: "abc123",
    lastIndexed: Date.now(),
    mtime: Date.now(),
    language: "typescript",
    symbolCount: 2,
    error: null,
  });

  const now = Date.now();
  const symAId = symbols.insert({
    fileId,
    name: "funcA",
    kind: "function",
    startLine: 1,
    endLine: 10,
    signature: "function funcA()",
    bodyHash: "hash-a",
    fullSource: "function funcA() {}",
    isExported: true,
    docComment: null,
    centrality: 0.5,
    lastSeen: now,
  });

  const symBId = symbols.insert({
    fileId,
    name: "funcB",
    kind: "function",
    startLine: 12,
    endLine: 20,
    signature: "function funcB()",
    bodyHash: "hash-b",
    fullSource: "function funcB() {}",
    isExported: true,
    docComment: null,
    centrality: 0.3,
    lastSeen: now,
  });

  edges.insert({
    sourceSymbolId: symBId,
    targetSymbolId: symAId,
    kind: "call",
    createdAt: now,
  });

  const sessionId = "test-session";
  db.prepare(
    "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, "claude-code", "/tmp", now);

  const obsIdA = obs.insert({
    sessionId,
    agentId: "claude-code",
    symbolId: symAId,
    fileId,
    scope: "architecture",
    note: "funcA handles auth",
    confidence: 1.0,
    createdAt: now,
    updatedAt: now,
    stale: false,
    staleReason: null,
    archived: false,
  });

  const obsIdB = obs.insert({
    sessionId,
    agentId: "claude-code",
    symbolId: symBId,
    fileId,
    scope: "pattern",
    note: "funcB calls funcA",
    confidence: 0.9,
    createdAt: now,
    updatedAt: now,
    stale: false,
    staleReason: null,
    archived: false,
  });

  const symA = symbols.getById(symAId)!;
  const symB = symbols.getById(symBId)!;

  return { fileId, symA, symB, obsIdA, obsIdB, sessionId };
}

describe("StalenessEngine", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
  });

  it("marks direct observations as stale when symbol is deleted", () => {
    const { symA, obsIdA, fileId } = seedDb(db);
    const engine = new StalenessEngine(db);

    const diff: IndexDiff = {
      added: [],
      modified: [],
      deleted: [symA],
      renamed: [],
      unchanged: [],
    };

    engine.propagateFromDiff(diff, fileId);

    const obs = observationQueries(db).getById(obsIdA);
    expect(obs?.stale).toBe(true);
    expect(obs?.staleReason).toBe("symbol_deleted");
  });

  it("marks direct observation as stale and decays dependent confidence on modification", () => {
    const { symA, obsIdA, obsIdB, fileId } = seedDb(db);
    const engine = new StalenessEngine(db);

    const diff: IndexDiff = {
      added: [],
      modified: [
        {
          old: symA,
          new: {
            name: "funcA",
            kind: "function",
            startLine: 1,
            endLine: 10,
            signature: "function funcA()",
            bodyHash: "hash-a-changed",
            fullSource: "function funcA() { return 1; }",
            isExported: true,
            docComment: null,
          },
        },
      ],
      deleted: [],
      renamed: [],
      unchanged: [],
    };

    engine.propagateFromDiff(diff, fileId);

    const obsA = observationQueries(db).getById(obsIdA);
    expect(obsA?.stale).toBe(true);

    const obsB = observationQueries(db).getById(obsIdB);
    expect(obsB?.stale).toBe(false);
    expect(obsB!.confidence).toBeLessThan(0.9);
  });

  it("decayConfidence reduces all active observation confidence", () => {
    const { obsIdA } = seedDb(db);
    const engine = new StalenessEngine(db);

    engine.decayConfidence(0.2);

    const obs = observationQueries(db).getById(obsIdA);
    expect(obs!.confidence).toBeCloseTo(0.8, 5);
  });

  it("runGC archives expired stale observations", () => {
    const { obsIdA } = seedDb(db);
    const obs = observationQueries(db);
    obs.markStale(obsIdA, "test");

    const engine = new StalenessEngine(db);
    const archived = engine.runGC({
      staleOlderThan: Date.now() + 1000,
      confidenceThreshold: 0.1,
    });

    expect(archived).toBeGreaterThanOrEqual(1);
    const record = obs.getById(obsIdA);
    expect(record?.archived).toBe(true);
  });

  it("runGC archives orphaned observations when symbol_id still references missing symbol", () => {
    const { symA, obsIdA, fileId } = seedDb(db);
    db.prepare("PRAGMA foreign_keys = OFF").run();
    db.prepare("DELETE FROM symbols WHERE id = ?").run(symA.id);
    db.prepare("PRAGMA foreign_keys = ON").run();

    const obs = observationQueries(db).getById(obsIdA);
    expect(obs?.symbolId).toBe(symA.id);

    const engine = new StalenessEngine(db);
    const archived = engine.runGC({ archiveOrphans: true });

    expect(archived).toBeGreaterThanOrEqual(1);
  });
});
