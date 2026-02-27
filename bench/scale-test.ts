import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";
import { upsertFileSummary } from "../src/core/file-summaries.js";
import { computeClusters } from "../src/core/clusters.js";
import { fileQueries } from "../src/db/queries/files.js";
import { symbolQueries } from "../src/db/queries/symbols.js";
import { edgeQueries } from "../src/db/queries/edges.js";

const SCALE = {
  FILES: 1000,
  SYMBOLS_PER_FILE: 5,
  EDGES_PER_SYMBOL: 3,
};

interface PerfResult {
  label: string;
  durationMs: number;
  memoryMb: number;
  symbolCount: number;
  confidence: number;
  passed: boolean;
}

async function buildSyntheticDatabase(): Promise<{ db: Database.Database; syntheticSymbolNames: string[] }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const files = fileQueries(db);
  const syms = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();

  process.stdout.write(`Generating ${SCALE.FILES} files, ${SCALE.FILES * SCALE.SYMBOLS_PER_FILE} symbols...\n`);

  const modules = ["capsule", "core", "db", "utils", "api", "worker", "parser", "resolver", "graph", "cache"];
  const verbs = ["generate", "build", "compute", "resolve", "process", "validate", "transform", "render", "parse", "execute"];
  const nouns = ["Node", "Graph", "Token", "Symbol", "Edge", "File", "Context", "Result", "Cache", "Queue"];

  const fileIds: number[] = [];
  const symbolIds: number[] = [];
  const syntheticSymbolNames: string[] = [];

  const insertFiles = db.transaction(() => {
    for (let i = 0; i < SCALE.FILES; i++) {
      const module = modules[i % modules.length]!;
      const path = `src/${module}/file-${i}.ts`;
      const fileId = files.insert({ path, hash: `hash-${i}`, lastIndexed: now, mtime: now, language: "typescript", symbolCount: SCALE.SYMBOLS_PER_FILE, error: null });
      fileIds.push(fileId);
    }
  });
  insertFiles();

  const insertSymbols = db.transaction(() => {
    for (let i = 0; i < fileIds.length; i++) {
      const verb = verbs[i % verbs.length]!;
      const noun = nouns[Math.floor(i / verbs.length) % nouns.length]!;
      for (let j = 0; j < SCALE.SYMBOLS_PER_FILE; j++) {
        const name = `${verb}${noun}${i * SCALE.SYMBOLS_PER_FILE + j}`;
        const symId = syms.insert({
          fileId: fileIds[i]!,
          name,
          kind: j === 0 ? "function" : "variable",
          startLine: j * 10 + 1,
          endLine: j * 10 + 9,
          signature: `function ${name}(params: unknown): void`,
          bodyHash: `body-${i}-${j}`,
          fullSource: `export function ${name}(params: unknown): void { /* generated */ }`,
          isExported: j === 0,
          docComment: null,
          centrality: 0,
          lastSeen: now,
        });
        symbolIds.push(symId);
        if (j === 0) syntheticSymbolNames.push(name);
      }
    }
  });
  insertSymbols();

  const insertEdges = db.transaction(() => {
    for (let i = 0; i < symbolIds.length; i++) {
      for (let k = 1; k <= SCALE.EDGES_PER_SYMBOL; k++) {
        const targetIdx = (i + k * 7) % symbolIds.length;
        if (targetIdx !== i) {
          try {
            edges.insert({ sourceSymbolId: symbolIds[i]!, targetSymbolId: symbolIds[targetIdx]!, kind: "call", createdAt: now });
          } catch {
            // ignore duplicate edges
          }
        }
      }
    }
  });
  insertEdges();

  process.stdout.write("Computing centrality and file summaries...\n");
  updateCentralityScores(db);
  for (const fileId of fileIds) {
    upsertFileSummary(db, fileId);
  }
  computeClusters(db);

  return { db, syntheticSymbolNames };
}

async function main(): Promise<void> {
  process.stdout.write(`Scale Test — ${SCALE.FILES} files, ${SCALE.FILES * SCALE.SYMBOLS_PER_FILE} symbols\n\n`);

  const buildStart = Date.now();
  const { db, syntheticSymbolNames } = await buildSyntheticDatabase();
  const buildMs = Date.now() - buildStart;
  process.stdout.write(`DB built in ${buildMs}ms\n\n`);

  const results: PerfResult[] = [];
  const testQueries = syntheticSymbolNames.slice(0, 5);

  for (const query of testQueries) {
    const heapBefore = process.memoryUsage().heapUsed;
    const queryStart = Date.now();

    const capsule = generateCapsule(db, { query, tokenBudget: 4000, maxQueryTimeMs: 500 });

    const queryMs = Date.now() - queryStart;
    const heapAfter = process.memoryUsage().heapUsed;
    const totalHeapMb = heapAfter / 1024 / 1024;
    const confidence = capsule.metadata.quality.coverageConfidence;

    const passed = queryMs < 500 && confidence > 0.3;

    results.push({
      label: query,
      durationMs: queryMs,
      memoryMb: totalHeapMb,
      symbolCount: capsule.metadata.symbolCount,
      confidence,
      passed,
    });

    process.stdout.write(
      `  "${query.slice(0, 40)}" → ${queryMs}ms, heap: ${totalHeapMb.toFixed(0)}MB, confidence: ${(confidence * 100).toFixed(1)}% — ${passed ? "PASS" : "FAIL"}\n`
    );
  }

  db.close();

  process.stdout.write("\n=== SUMMARY ===\n");
  const avgMs = results.reduce((a, r) => a + r.durationMs, 0) / results.length;
  const maxMs = Math.max(...results.map((r) => r.durationMs));
  const maxMem = Math.max(...results.map((r) => r.memoryMb));
  const avgConfidence = results.reduce((a, r) => a + r.confidence, 0) / results.length;
  const allPassed = results.every((r) => r.passed);

  process.stdout.write(`DB size:          ${SCALE.FILES} files, ${SCALE.FILES * SCALE.SYMBOLS_PER_FILE} symbols\n`);
  process.stdout.write(`Build time:       ${buildMs}ms\n`);
  process.stdout.write(`Avg query time:   ${avgMs.toFixed(0)}ms (target: <500ms)\n`);
  process.stdout.write(`Max query time:   ${maxMs}ms\n`);
  process.stdout.write(`Max heap:         ${maxMem.toFixed(0)}MB (target: <512MB)\n`);
  process.stdout.write(`Avg confidence:   ${(avgConfidence * 100).toFixed(1)}%\n`);
  process.stdout.write(`Status:           ${allPassed ? "PASS" : "FAIL"}\n`);
}

main().catch((err) => {
  process.stderr.write(`Scale test failed: ${err}\n`);
  process.exit(1);
});
