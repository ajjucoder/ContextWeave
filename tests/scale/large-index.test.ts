import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { updateCentralityScores } from "../../src/core/graph.js";

describe("large codebase simulation", () => {
  let db: Database.Database;
  const FILE_COUNT = 2000;
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
        const dir = `src/module${Math.floor(f / 50)}`;
        const path = `${dir}/file${f}.ts`;
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
      for (let i = 1; i < Math.min(allSymbolIds.length, 5000); i++) {
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
  });

  afterAll(() => {
    db.close();
  });

  it("indexes expected number of files and symbols", () => {
    const files = fileQueries(db);
    const symbols = symbolQueries(db);
    expect(files.count()).toBe(FILE_COUNT);
    expect(symbols.count()).toBe(FILE_COUNT * SYMBOLS_PER_FILE);
  });

  it("iterateAll streams all files without loading into memory", () => {
    const files = fileQueries(db);
    let count = 0;
    for (const _file of files.iterateAll()) {
      count++;
      if (count > 100) break;
    }
    expect(count).toBe(101);
  });

  it("getAllPathsAndMtimes returns lightweight records", () => {
    const files = fileQueries(db);
    const records = files.getAllPathsAndMtimes();
    expect(records.length).toBe(FILE_COUNT);
    expect(records[0]).toHaveProperty("id");
    expect(records[0]).toHaveProperty("path");
    expect(records[0]).toHaveProperty("mtime");
    expect(records[0]).not.toHaveProperty("hash");
  });

  it("generates capsule within budget for large codebase", () => {
    const sessionId = "scale-test";
    db.prepare(
      "INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
    ).run(sessionId, "claude-code", "/tmp/scale-project", Date.now());

    const result = generateCapsule(db, {
      query: "sym_1_0",
      tokenBudget: 4000,
      mode: "feature",
      sessionId,
      projectRoot: "/tmp/scale-project",
    });

    expect(result.metadata.tokensUsed).toBeLessThanOrEqual(6000);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect(result.metadata.symbolCount).toBeGreaterThan(0);
  });

  it("capsule generation completes within 5 seconds for large codebase", () => {
    const sessionId = "scale-test";
    const start = performance.now();

    generateCapsule(db, {
      query: "how does module5 work",
      tokenBudget: 8000,
      mode: "feature",
      sessionId,
      projectRoot: "/tmp/scale-project",
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
