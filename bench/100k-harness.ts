import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { closeDb, getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { symbolQueries } from "../src/db/queries/symbols.js";
import { edgeQueries } from "../src/db/queries/edges.js";
import { countTokens } from "../src/utils/tokens.js";
import { generateCapsule } from "../src/capsule/generator.js";
import {
  countSyntheticProjectLoc,
  createSyntheticProject,
  removeSyntheticProject,
  type SyntheticQueryCase,
} from "../src/bench/synthetic-project.js";

const TARGET_LOC = Number(process.env["CW_100K_TARGET_LOC"] ?? "100000");
const FILE_COUNT = Number(process.env["CW_100K_FILE_COUNT"] ?? "500");
const MODULE_COUNT = Number(process.env["CW_100K_MODULE_COUNT"] ?? "10");
const TOKEN_BUDGET = Number(process.env["CW_100K_TOKEN_BUDGET"] ?? "4000");
const MAX_QUERY_TIME_MS = Number(process.env["CW_100K_MAX_QUERY_TIME_MS"] ?? "800");
const P95_TARGET_MS = Number(process.env["CW_100K_P95_TARGET_MS"] ?? "200");
const AVG_CONFIDENCE_TARGET = Number(process.env["CW_100K_CONFIDENCE_TARGET"] ?? "0.45");
const AVG_REDUCTION_TARGET = Number(process.env["CW_100K_REDUCTION_TARGET"] ?? "90");
const MAX_HEAP_MB = Number(process.env["CW_100K_MAX_HEAP_MB"] ?? "1024");

const FIXTURE_ROOT = resolve(import.meta.dirname, ".synthetic-100k");
const DB_PATH = resolve(import.meta.dirname, ".bench-100k.db");

interface QueryRunResult {
  kind: SyntheticQueryCase["kind"];
  label: string;
  query: string;
  latencyMs: number;
  tokensUsed: number;
  tokenReductionPct: number;
  confidence: number;
  symbolCount: number;
  stageA: number;
  stageB: number;
  expectedHit: boolean | null;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

function pad(s: string, width: number, right = false): string {
  return right ? s.padStart(width) : s.padEnd(width);
}

function cleanupDbFiles(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${DB_PATH}${suffix}`;
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}

function cleanupArtifacts(): void {
  removeSyntheticProject(FIXTURE_ROOT);
  cleanupDbFiles();
}

function getTotalRawTokens(rootDir: string, relativePaths: string[]): number {
  let total = 0;
  for (const relativePath of relativePaths) {
    const content = readFileSync(resolve(rootDir, relativePath), "utf-8");
    total += countTokens(content);
  }
  return total;
}

function printReport(
  indexMs: number,
  fileCount: number,
  symbolCount: number,
  edgeCount: number,
  loc: number,
  rawTokens: number,
  results: QueryRunResult[]
): void {
  const avgReduction = results.reduce((sum, result) => sum + result.tokenReductionPct, 0) / results.length;
  const avgConfidence = results.reduce((sum, result) => sum + result.confidence, 0) / results.length;
  const p50Latency = percentile(results.map((result) => result.latencyMs), 0.5);
  const p95Latency = percentile(results.map((result) => result.latencyMs), 0.95);

  console.log("\nContextWeave 100K LOC Harness Report");
  console.log("====================================");
  console.log(`Fixture: synthetic (${loc} LOC, ${fileCount} files, ${symbolCount} symbols, ${edgeCount} edges)`);
  console.log(`Index time: ${indexMs}ms`);
  console.log(`Raw tokens: ${rawTokens}`);
  console.log();

  const colKind = 8;
  const colLabel = 20;
  const colTokens = 8;
  const colReduce = 11;
  const colConf = 7;
  const colLat = 8;
  const colHit = 5;

  console.log(
    `${pad("Kind", colKind)} | ${pad("Label", colLabel)} | ${pad("Tokens", colTokens, true)} | ${pad("Reduction", colReduce, true)} | ${pad("Conf", colConf, true)} | ${pad("Latency", colLat, true)} | ${pad("Hit", colHit, true)}`
  );
  console.log(
    `${"-".repeat(colKind)}-|-${"-".repeat(colLabel)}-|-${"-".repeat(colTokens)}-|-${"-".repeat(colReduce)}-|-${"-".repeat(colConf)}-|-${"-".repeat(colLat)}-|-${"-".repeat(colHit)}`
  );

  for (const result of results) {
    const hitLabel = result.expectedHit === null ? "n/a" : result.expectedHit ? "yes" : "no";
    console.log(
      `${pad(result.kind, colKind)} | ${pad(result.label, colLabel)} | ${pad(String(result.tokensUsed), colTokens, true)} | ${pad(result.tokenReductionPct.toFixed(1) + "%", colReduce, true)} | ${pad((result.confidence * 100).toFixed(1) + "%", colConf, true)} | ${pad(result.latencyMs + "ms", colLat, true)} | ${pad(hitLabel, colHit, true)}`
    );
  }

  console.log();
  console.log(`p50 latency: ${p50Latency.toFixed(1)}ms`);
  console.log(`p95 latency: ${p95Latency.toFixed(1)}ms (target <= ${P95_TARGET_MS}ms)`);
  console.log(`Avg confidence: ${(avgConfidence * 100).toFixed(1)}% (target >= ${(AVG_CONFIDENCE_TARGET * 100).toFixed(1)}%)`);
  console.log(`Avg token reduction: ${avgReduction.toFixed(1)}% (target >= ${AVG_REDUCTION_TARGET.toFixed(1)}%)`);
  console.log(`Heap usage: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)}MB (target <= ${MAX_HEAP_MB.toFixed(1)}MB)`);
  console.log();
}

function ensureFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number`);
  }
}

async function main(): Promise<void> {
  ensureFinitePositive(TARGET_LOC, "CW_100K_TARGET_LOC");
  ensureFinitePositive(FILE_COUNT, "CW_100K_FILE_COUNT");
  ensureFinitePositive(MODULE_COUNT, "CW_100K_MODULE_COUNT");
  ensureFinitePositive(TOKEN_BUDGET, "CW_100K_TOKEN_BUDGET");
  ensureFinitePositive(MAX_QUERY_TIME_MS, "CW_100K_MAX_QUERY_TIME_MS");
  ensureFinitePositive(P95_TARGET_MS, "CW_100K_P95_TARGET_MS");
  ensureFinitePositive(AVG_CONFIDENCE_TARGET, "CW_100K_CONFIDENCE_TARGET");
  ensureFinitePositive(AVG_REDUCTION_TARGET, "CW_100K_REDUCTION_TARGET");
  ensureFinitePositive(MAX_HEAP_MB, "CW_100K_MAX_HEAP_MB");

  cleanupArtifacts();

  const manifest = createSyntheticProject({
    rootDir: FIXTURE_ROOT,
    targetLoc: Math.floor(TARGET_LOC),
    fileCount: Math.floor(FILE_COUNT),
    moduleCount: Math.floor(MODULE_COUNT),
  });

  const db = getDb(DB_PATH);
  runMigrations(db);

  let closed = false;
  const close = () => {
    if (closed) return;
    closeDb(DB_PATH);
    closed = true;
  };

  try {
    const indexStart = Date.now();
    const indexResult = await indexProject(db, FIXTURE_ROOT);
    updateCentralityScores(db);
    const indexMs = Date.now() - indexStart;

    const symbolCount = symbolQueries(db).count();
    const edgeCount = edgeQueries(db).count();
    const measuredLoc = countSyntheticProjectLoc(manifest);
    const rawTokens = getTotalRawTokens(manifest.rootDir, manifest.files);

    const results: QueryRunResult[] = [];
    for (const queryCase of manifest.queryCases) {
      const started = Date.now();
      const capsule = generateCapsule(db, {
        query: queryCase.query,
        tokenBudget: TOKEN_BUDGET,
        maxQueryTimeMs: MAX_QUERY_TIME_MS,
      });
      const latencyMs = Date.now() - started;
      const tokenReductionPct =
        rawTokens > 0 ? (1 - capsule.metadata.tokensUsed / rawTokens) * 100 : 0;
      const expectedHit =
        capsule.content.includes(queryCase.expectedSymbol) ||
        capsule.content.includes(queryCase.expectedFile.replace(/\\/g, "/"));

      results.push({
        kind: queryCase.kind,
        label: queryCase.label,
        query: queryCase.query,
        latencyMs,
        tokensUsed: capsule.metadata.tokensUsed,
        tokenReductionPct,
        confidence: capsule.metadata.quality.coverageConfidence,
        symbolCount: capsule.metadata.symbolCount,
        stageA: capsule.metadata.quality.retrieval.stageACandidateCount,
        stageB: capsule.metadata.quality.retrieval.stageBSelectedCount,
        expectedHit,
      });
    }

    printReport(indexMs, manifest.fileCount, symbolCount, edgeCount, measuredLoc, rawTokens, results);

    const avgReduction = results.reduce((sum, result) => sum + result.tokenReductionPct, 0) / results.length;
    const avgConfidence = results.reduce((sum, result) => sum + result.confidence, 0) / results.length;
    const p95Latency = percentile(results.map((result) => result.latencyMs), 0.95);
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;

    const qualityMisses = results.filter((result) => result.expectedHit === false);
    const unhealthyQueries = results.filter((result) =>
      result.stageA <= 0 ||
      result.stageB <= 0 ||
      result.symbolCount <= 0 ||
      result.latencyMs > MAX_QUERY_TIME_MS
    );

    const checks: Array<{ ok: boolean; detail: string }> = [
      { ok: manifest.actualLoc === manifest.targetLoc, detail: `Generated LOC ${manifest.actualLoc} matches target ${manifest.targetLoc}` },
      { ok: measuredLoc === manifest.targetLoc, detail: `Measured LOC ${measuredLoc} matches target ${manifest.targetLoc}` },
      { ok: indexResult.filesIndexed === manifest.fileCount, detail: `Indexed files ${indexResult.filesIndexed} matches generated files ${manifest.fileCount}` },
      { ok: p95Latency <= P95_TARGET_MS, detail: `p95 latency ${p95Latency.toFixed(1)}ms <= ${P95_TARGET_MS}ms` },
      { ok: avgConfidence >= AVG_CONFIDENCE_TARGET, detail: `avg confidence ${(avgConfidence * 100).toFixed(1)}% >= ${(AVG_CONFIDENCE_TARGET * 100).toFixed(1)}%` },
      { ok: avgReduction >= AVG_REDUCTION_TARGET, detail: `avg token reduction ${avgReduction.toFixed(1)}% >= ${AVG_REDUCTION_TARGET.toFixed(1)}%` },
      { ok: heapMb <= MAX_HEAP_MB, detail: `heap usage ${heapMb.toFixed(1)}MB <= ${MAX_HEAP_MB.toFixed(1)}MB` },
      { ok: qualityMisses.length === 0, detail: `expected hits ${results.length - qualityMisses.length}/${results.length}` },
      { ok: unhealthyQueries.length === 0, detail: `healthy query runs ${results.length - unhealthyQueries.length}/${results.length}` },
    ];

    let passed = true;
    console.log("Checks:");
    for (const check of checks) {
      console.log(`- ${check.ok ? "PASS" : "FAIL"}: ${check.detail}`);
      if (!check.ok) passed = false;
    }

    if (!passed) {
      if (qualityMisses.length > 0) {
        console.error("\nExpected-hit misses:");
        for (const miss of qualityMisses) {
          console.error(`- ${miss.label}: ${miss.query}`);
        }
      }
      if (unhealthyQueries.length > 0) {
        console.error("\nUnhealthy query runs:");
        for (const failed of unhealthyQueries) {
          console.error(
            `- ${failed.label}: stageA=${failed.stageA}, stageB=${failed.stageB}, symbols=${failed.symbolCount}, latency=${failed.latencyMs}ms`
          );
        }
      }
      process.exit(1);
    }
  } finally {
    close();
    cleanupArtifacts();
  }
}

main().catch((error) => {
  console.error(error);
  closeDb(DB_PATH);
  cleanupArtifacts();
  process.exit(1);
});
