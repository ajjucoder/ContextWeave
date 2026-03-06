import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { updateCentralityScores, getBatchSymbolDegrees, computePageRank } from "../../src/core/graph.js";

describe("5M line codebase simulation", { timeout: 120000 }, () => {
  let db: Database.Database;
  const FILE_COUNT = 50000;
  const SYMBOLS_PER_FILE = 10;
  const EDGE_COUNT = 30000;
  const BATCH_SIZE = 5000;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    createSchema(db);
    runMigrations(db);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const now = Date.now();

    for (let batchStart = 0; batchStart < FILE_COUNT; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, FILE_COUNT);
      const insertBatch = db.transaction(() => {
        for (let f = batchStart; f < batchEnd; f++) {
          files.insert({
            path: `src/mod${Math.floor(f / 100)}/file${f}.ts`,
            hash: `hash-${f}`,
            lastIndexed: now,
            mtime: now,
            language: "typescript",
            symbolCount: SYMBOLS_PER_FILE,
            error: null,
          });
        }
      });
      insertBatch();
    }

    const allFiles = files.getAllPathsAndMtimes();

    for (let batchStart = 0; batchStart < allFiles.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, allFiles.length);
      const insertSymbolBatch = db.transaction(() => {
        for (let fi = batchStart; fi < batchEnd; fi++) {
          const file = allFiles[fi]!;
          for (let s = 0; s < SYMBOLS_PER_FILE; s++) {
            symbols.insert({
              fileId: file.id,
              name: `sym_${file.id}_${s}`,
              kind: s < 3 ? "function" : s < 6 ? "class" : "variable",
              startLine: s * 10 + 1,
              endLine: s * 10 + 9,
              signature: `function sym_${file.id}_${s}()`,
              bodyHash: `body-${file.id}-${s}`,
              fullSource: `function sym_${file.id}_${s}() { return ${s}; }`,
              isExported: s < 5,
              docComment: null,
              centrality: 0,
              lastSeen: now,
            });
          }
        }
      });
      insertSymbolBatch();
    }

    const allSymbolIds = symbols.getAllIds();
    const insertEdges = db.transaction(() => {
      for (let i = 0; i < EDGE_COUNT; i++) {
        const sourceIdx = Math.floor(Math.random() * allSymbolIds.length);
        const targetIdx = Math.floor(Math.random() * allSymbolIds.length);
        if (sourceIdx === targetIdx) continue;
        edges.insert({
          sourceSymbolId: allSymbolIds[sourceIdx]!,
          targetSymbolId: allSymbolIds[targetIdx]!,
          kind: "call",
          createdAt: now,
        });
      }
    });
    insertEdges();

    updateCentralityScores(db);
  }, 120000);

  afterAll(() => {
    db.close();
  });

  it("indexes expected file and symbol counts", () => {
    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    expect(files.count()).toBe(FILE_COUNT);
    expect(symbols.count()).toBe(FILE_COUNT * SYMBOLS_PER_FILE);
  });

  it("capsule generation completes within 15 seconds", { timeout: 120000 }, () => {
    const sessionId = "extreme-scale-5m-capsule";
    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, "claude-code", "/tmp/scale-project", Date.now());

    const start = performance.now();
    generateCapsule(db, {
      query: "sym_1_0",
      tokenBudget: 8000,
      mode: "feature",
      sessionId,
      projectRoot: "/tmp/scale-project",
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(15000);
  });

  it("streaming file iteration handles 50k files", () => {
    const files = fileQueries(db);
    let count = 0;
    for (const _file of files.iterateAll()) {
      count++;
      if (count > 1000) break;
    }
    expect(count).toBe(1001);
  });

  it("batch degree queries handle large graph", () => {
    const symbols = symbolQueries(db);
    const allIds = symbols.getAllIds();
    const sample = allIds.slice(0, 5000);
    const degrees = getBatchSymbolDegrees(db, sample);
    expect(degrees).toBeInstanceOf(Map);
    expect(degrees.size).toBeLessThanOrEqual(5000);
  });

  it("PageRank computes without OOM for 500k symbols", { timeout: 120000 }, () => {
    const symbols = symbolQueries(db);
    const totalSymbols = symbols.count();
    const ranks = computePageRank(db);
    expect(ranks).toBeInstanceOf(Map);
    expect(ranks.size).toBe(totalSymbols);
  });
});

describe("10M line codebase simulation", { timeout: 120000 }, () => {
  let db: Database.Database;
  const FILE_COUNT = 100000;
  const SYMBOLS_PER_FILE = 10;
  const EDGE_COUNT = 50000;
  const BATCH_SIZE = 10000;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    createSchema(db);
    runMigrations(db);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const now = Date.now();

    for (let batchStart = 0; batchStart < FILE_COUNT; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, FILE_COUNT);
      const insertBatch = db.transaction(() => {
        for (let f = batchStart; f < batchEnd; f++) {
          files.insert({
            path: `src/mod${Math.floor(f / 100)}/file${f}.ts`,
            hash: `hash-${f}`,
            lastIndexed: now,
            mtime: now,
            language: "typescript",
            symbolCount: SYMBOLS_PER_FILE,
            error: null,
          });
        }
      });
      insertBatch();
    }

    const allFiles = files.getAllPathsAndMtimes();

    for (let batchStart = 0; batchStart < allFiles.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, allFiles.length);
      const insertSymbolBatch = db.transaction(() => {
        for (let fi = batchStart; fi < batchEnd; fi++) {
          const file = allFiles[fi]!;
          for (let s = 0; s < SYMBOLS_PER_FILE; s++) {
            symbols.insert({
              fileId: file.id,
              name: `sym_${file.id}_${s}`,
              kind: s < 3 ? "function" : s < 6 ? "class" : "variable",
              startLine: s * 10 + 1,
              endLine: s * 10 + 9,
              signature: `function sym_${file.id}_${s}()`,
              bodyHash: `body-${file.id}-${s}`,
              fullSource: `function sym_${file.id}_${s}() { return ${s}; }`,
              isExported: s < 5,
              docComment: null,
              centrality: 0,
              lastSeen: now,
            });
          }
        }
      });
      insertSymbolBatch();
    }

    const allSymbolIds = symbols.getAllIds();
    const insertEdges = db.transaction(() => {
      for (let i = 0; i < EDGE_COUNT; i++) {
        const sourceIdx = Math.floor(Math.random() * allSymbolIds.length);
        const targetIdx = Math.floor(Math.random() * allSymbolIds.length);
        if (sourceIdx === targetIdx) continue;
        edges.insert({
          sourceSymbolId: allSymbolIds[sourceIdx]!,
          targetSymbolId: allSymbolIds[targetIdx]!,
          kind: "call",
          createdAt: now,
        });
      }
    });
    insertEdges();

    updateCentralityScores(db);
  }, 120000);

  afterAll(() => {
    db.close();
  });

  it("indexes expected file and symbol counts", () => {
    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    expect(files.count()).toBe(FILE_COUNT);
    expect(symbols.count()).toBe(FILE_COUNT * SYMBOLS_PER_FILE);
  });

  it("capsule generation completes within 20 seconds", { timeout: 120000 }, () => {
    const sessionId = "extreme-scale-10m-capsule";
    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, "claude-code", "/tmp/scale-project", Date.now());

    const start = performance.now();
    generateCapsule(db, {
      query: "sym_1_0",
      tokenBudget: 8000,
      mode: "feature",
      sessionId,
      projectRoot: "/tmp/scale-project",
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20000);
  });

  it("lightweight query returns all 100k files", () => {
    const files = fileQueries(db);
    const records = files.getAllPathsAndMtimes();
    expect(records.length).toBe(FILE_COUNT);
    expect(records[0]).toHaveProperty("id");
    expect(records[0]).toHaveProperty("path");
    expect(records[0]).toHaveProperty("mtime");
  });

  it("streaming iteration supports early termination on 100k files", () => {
    const files = fileQueries(db);
    let count = 0;
    for (const _file of files.iterateAll()) {
      count++;
      if (count > 1000) break;
    }
    expect(count).toBe(1001);
  });

  it("PageRank handles 1M symbol graph", { timeout: 120000 }, () => {
    const symbols = symbolQueries(db);
    const totalSymbols = symbols.count();
    const ranks = computePageRank(db);
    expect(ranks).toBeInstanceOf(Map);
    expect(ranks.size).toBe(totalSymbols);
  });
});
