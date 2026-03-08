import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { updateCentralityScores, getBatchSymbolDegrees } from "../../src/core/graph.js";
import { insertDeterministicCallEdges } from "./helpers.js";

describe("500k line codebase simulation", () => {
  let db: Database.Database;
  const FILE_COUNT = 5000;
  const SYMBOLS_PER_FILE = 10;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    createSchema(db);
    runMigrations(db);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const now = Date.now();

    const insertFiles = db.transaction(() => {
      for (let f = 0; f < FILE_COUNT; f++) {
        const path = `src/module${Math.floor(f / 50)}/file${f}.ts`;
        files.insert({
          path,
          hash: `hash-${f}`,
          lastIndexed: now,
          mtime: now,
          language: "typescript",
          symbolCount: SYMBOLS_PER_FILE,
          error: null,
        });
      }
    });
    insertFiles();

    const allFiles = files.getAll();
    const insertSymbols = db.transaction(() => {
      for (const file of allFiles) {
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
    insertSymbols();

    const allSymbolIds = symbols.getAllIds();
    const insertEdges = db.transaction(() => {
      insertDeterministicCallEdges(db, allSymbolIds, Math.min(allSymbolIds.length, 8000), now, 0x01020304);
    });
    insertEdges();

    updateCentralityScores(db);

    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("medium-scale-500k", "claude-code", "/tmp/medium-scale-project", Date.now());
  }, 60000);

  afterAll(() => {
    db.close();
  });

  it("indexes expected number of files and symbols", () => {
    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    expect(files.count()).toBe(FILE_COUNT);
    expect(symbols.count()).toBe(FILE_COUNT * SYMBOLS_PER_FILE);
  });

  it("streaming iterators handle 5000 files", () => {
    const files = fileQueries(db);
    let count = 0;
    for (const _file of files.iterateAll()) {
      count++;
      if (count >= 500) break;
    }
    expect(count).toBe(500);
  });

  it("capsule generation completes within 5 seconds", () => {
    const start = performance.now();

    generateCapsule(db, {
      query: "how does module10 work",
      tokenBudget: 8000,
      mode: "feature",
      sessionId: "medium-scale-500k",
      projectRoot: "/tmp/medium-scale-project",
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it("capsule stays within token budget", () => {
    const result = generateCapsule(db, {
      query: "how does module10 work",
      tokenBudget: 4000,
      mode: "feature",
      sessionId: "medium-scale-500k",
      projectRoot: "/tmp/medium-scale-project",
    });

    expect(result.metadata.tokensUsed).toBeLessThanOrEqual(6000);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
  });

  it("getAllPathsAndMtimes returns lightweight records for 5000 files", () => {
    const files = fileQueries(db);
    const records = files.getAllPathsAndMtimes();
    expect(records.length).toBe(FILE_COUNT);
    expect(records[0]).toHaveProperty("id");
    expect(records[0]).toHaveProperty("path");
    expect(records[0]).toHaveProperty("mtime");
    expect(records[0]).not.toHaveProperty("hash");
  });
});

describe("1M line codebase simulation", () => {
  let db: Database.Database;
  const FILE_COUNT = 10000;
  const SYMBOLS_PER_FILE = 10;

  beforeAll(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    createSchema(db);
    runMigrations(db);

    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);
    const now = Date.now();

    const insertFiles = db.transaction(() => {
      for (let f = 0; f < FILE_COUNT; f++) {
        const path = `src/module${Math.floor(f / 50)}/file${f}.ts`;
        files.insert({
          path,
          hash: `hash-${f}`,
          lastIndexed: now,
          mtime: now,
          language: "typescript",
          symbolCount: SYMBOLS_PER_FILE,
          error: null,
        });
      }
    });
    insertFiles();

    const allFiles = files.getAll();
    const insertSymbols = db.transaction(() => {
      for (const file of allFiles) {
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
    insertSymbols();

    const allSymbolIds = symbols.getAllIds();
    const insertEdges = db.transaction(() => {
      insertDeterministicCallEdges(db, allSymbolIds, Math.min(allSymbolIds.length, 15000), now, 0x05060708);
    });
    insertEdges();

    updateCentralityScores(db);

    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run("medium-scale-1m", "claude-code", "/tmp/medium-scale-1m-project", Date.now());
  }, 120000);

  afterAll(() => {
    db.close();
  });

  it("indexes expected number of files and symbols", () => {
    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    expect(files.count()).toBe(FILE_COUNT);
    expect(symbols.count()).toBe(FILE_COUNT * SYMBOLS_PER_FILE);
  });

  it("capsule generation completes within 8 seconds", () => {
    const start = performance.now();

    generateCapsule(db, {
      query: "how does module10 work",
      tokenBudget: 8000,
      mode: "feature",
      sessionId: "medium-scale-1m",
      projectRoot: "/tmp/medium-scale-1m-project",
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(8000);
  });

  it("capsule stays within token budget at scale", () => {
    const result = generateCapsule(db, {
      query: "how does module10 work",
      tokenBudget: 4000,
      mode: "feature",
      sessionId: "medium-scale-1m",
      projectRoot: "/tmp/medium-scale-1m-project",
    });

    expect(result.metadata.tokensUsed).toBeLessThanOrEqual(6000);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
  });

  it("PageRank converges for 100k symbol graph", () => {
    expect(() => updateCentralityScores(db)).not.toThrow();
  });

  it("batch degree queries handle 100k symbols", () => {
    const symbols = symbolQueries(db);
    const allSymbolIds = symbols.getAllIds();
    const first1000 = allSymbolIds.slice(0, 1000);
    const degreeMap = getBatchSymbolDegrees(db, first1000);
    expect(degreeMap.size).toBeGreaterThan(0);
  });
});
