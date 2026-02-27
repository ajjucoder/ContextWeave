import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, rmSync } from "node:fs";
import { closeDb, getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DB_PATH = resolve(__dirname, ".concurrent-stress.db");
const WORKER_SCRIPT = resolve(__dirname, "workers/concurrent-capsule-worker.ts");
const INDEX_TARGET = resolve(PROJECT_ROOT, "src");
const QUERIES = [
  "generateCapsule",
  "weightedBfsTraversal",
  "SessionContext",
  "capsule generation pipeline scoring",
  "MCP server tool registration",
];

interface WorkerResult {
  agentId: string;
  latenciesMs: number[];
  successCount: number;
  errors: string[];
}

const AGENTS = Number(process.env["CW_STRESS_AGENTS"] ?? "10");
const ITERATIONS = Number(process.env["CW_STRESS_ITERATIONS"] ?? "20");
const TOKEN_BUDGET = Number(process.env["CW_STRESS_TOKEN_BUDGET"] ?? "3500");
const P95_TARGET_MS = Number(process.env["CW_STRESS_P95_TARGET_MS"] ?? "50");
const THROUGHPUT_TARGET = Number(process.env["CW_STRESS_THROUGHPUT_TARGET"] ?? "10");

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

function summarize(results: WorkerResult[], durationMs: number): {
  totalCalls: number;
  errors: string[];
  p50: number;
  p95: number;
  p99: number;
  throughput: number;
} {
  const latencies = results.flatMap((result) => result.latenciesMs);
  const errors = results.flatMap((result) => result.errors);
  const totalCalls = latencies.length;
  const throughput = durationMs > 0 ? (totalCalls / durationMs) * 1000 : 0;

  return {
    totalCalls,
    errors,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    throughput,
  };
}

async function setupDatabase(): Promise<void> {
  if (existsSync(DB_PATH)) {
    rmSync(DB_PATH, { force: true });
    rmSync(`${DB_PATH}-wal`, { force: true });
    rmSync(`${DB_PATH}-shm`, { force: true });
  }

  const db = getDb(DB_PATH);
  runMigrations(db);
  await indexProject(db, INDEX_TARGET);
  updateCentralityScores(db);
  closeDb(DB_PATH);
}

async function runStress(): Promise<void> {
  await setupDatabase();

  const payloads = Array.from({ length: AGENTS }, (_, index) => ({
    agentId: `agent-${index + 1}`,
    dbPath: DB_PATH,
    queries: QUERIES,
    iterations: ITERATIONS,
    tokenBudget: TOKEN_BUDGET,
    sessionPrefix: `stress-${index + 1}`,
  }));

  const startedAt = Date.now();
  const executions = payloads.map(async (payload) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", WORKER_SCRIPT, JSON.stringify(payload)],
      {
        cwd: PROJECT_ROOT,
        maxBuffer: 8 * 1024 * 1024,
      }
    );
    return JSON.parse(stdout.trim()) as WorkerResult;
  });

  const results = await Promise.all(executions);
  const durationMs = Date.now() - startedAt;
  const summary = summarize(results, durationMs);
  const errorRate = summary.totalCalls > 0 ? (summary.errors.length / summary.totalCalls) * 100 : 0;

  console.log("Concurrent Stress Report");
  console.log("========================");
  console.log(`Agents:         ${AGENTS}`);
  console.log(`Iterations:     ${ITERATIONS}`);
  console.log(`Total calls:    ${summary.totalCalls}`);
  console.log(`Duration:       ${durationMs}ms`);
  console.log(`p50 latency:    ${summary.p50.toFixed(2)}ms`);
  console.log(`p95 latency:    ${summary.p95.toFixed(2)}ms`);
  console.log(`p99 latency:    ${summary.p99.toFixed(2)}ms`);
  console.log(`Throughput:     ${summary.throughput.toFixed(2)} capsules/s`);
  console.log(`Error rate:     ${errorRate.toFixed(2)}%`);

  if (summary.errors.length > 0) {
    console.error("\nErrors:");
    for (const error of summary.errors.slice(0, 10)) {
      console.error(`- ${error}`);
    }
  }

  const passed =
    summary.errors.length === 0 &&
    summary.p95 < P95_TARGET_MS &&
    summary.throughput >= THROUGHPUT_TARGET;

  console.log(`\nTargets: p95 < ${P95_TARGET_MS}ms, errors = 0, throughput >= ${THROUGHPUT_TARGET}/s`);
  console.log(`Status: ${passed ? "PASS" : "FAIL"}`);

  closeDb(DB_PATH);

  if (!passed) {
    process.exit(1);
  }
}

runStress().catch((error) => {
  console.error(error);
  closeDb(DB_PATH);
  process.exit(1);
});
