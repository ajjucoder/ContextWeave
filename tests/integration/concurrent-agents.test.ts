import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { closeDb, getDb } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const WORKER_SCRIPT = resolve(PROJECT_ROOT, "bench/workers/concurrent-capsule-worker.ts");
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

const AGENT_COUNT = 10;
const ITERATIONS_PER_AGENT = 4;
const P95_TARGET_MS = 50;
const QUERIES = ["UserService", "validateEmail", "loadUser", "getDefaultRole"];

interface CapsuleWorkerPayload {
  mode?: "capsule";
  agentId: string;
  dbPath: string;
  queries: string[];
  iterations: number;
  tokenBudget: number;
  sessionPrefix: string;
}

interface ReindexWorkerPayload {
  mode: "reindex";
  agentId: string;
  dbPath: string;
  iterations: number;
  projectRoot: string;
  filePath: string;
}

type WorkerPayload = CapsuleWorkerPayload | ReindexWorkerPayload;

interface WorkerResult {
  agentId: string;
  latenciesMs: number[];
  successCount: number;
  errors: string[];
}

let tempRoot = "";
let dbPath = "";
let fixtureRoot = "";
let writerFilePath = "";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

async function runWorker(payload: WorkerPayload): Promise<WorkerResult> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", WORKER_SCRIPT, JSON.stringify(payload)],
    {
      cwd: PROJECT_ROOT,
      maxBuffer: 4 * 1024 * 1024,
    }
  );

  return JSON.parse(stdout.trim()) as WorkerResult;
}

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), "cw-concurrency-"));
  fixtureRoot = join(tempRoot, "fixture-copy");
  cpSync(FIXTURE_DIR, fixtureRoot, { recursive: true });
  writerFilePath = join(fixtureRoot, "concurrency-churn.ts");
  writeFileSync(writerFilePath, "export function churn_0() { return 0; }\n", "utf-8");

  const cwDir = join(tempRoot, ".contextweave");
  mkdirSync(cwDir, { recursive: true });
  dbPath = join(cwDir, "contextweave.db");

  const db = getDb(dbPath);
  runMigrations(db);
  await indexProject(db, fixtureRoot);
  updateCentralityScores(db);
  closeDb(dbPath);
}, 60000);

afterAll(() => {
  closeDb(dbPath);
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("concurrent capsule generation", () => {
  it("handles 10 simultaneous agents without SQLITE_BUSY failures", async () => {
    const payloads = Array.from({ length: AGENT_COUNT }, (_, index) => ({
      agentId: `agent-${index + 1}`,
      dbPath,
      queries: QUERIES,
      iterations: ITERATIONS_PER_AGENT,
      tokenBudget: 3000,
      sessionPrefix: `agent-${index + 1}`,
    }));

    const startedAt = Date.now();
    const results = await Promise.all(payloads.map((payload) => runWorker(payload)));
    const durationMs = Date.now() - startedAt;

    const allErrors = results.flatMap((result) => result.errors);
    expect(allErrors).toEqual([]);

    const successes = results.reduce((sum, result) => sum + result.successCount, 0);
    const expectedCalls = AGENT_COUNT * ITERATIONS_PER_AGENT;
    expect(successes).toBe(expectedCalls);

    const latencies = results.flatMap((result) => result.latenciesMs);
    expect(latencies.length).toBe(expectedCalls);
    // Ignore the first call per agent to avoid startup JIT/process noise in steady-state p95.
    const steadyStateLatencies = results.flatMap((result) => result.latenciesMs.slice(1));
    expect(steadyStateLatencies.length).toBe(expectedCalls - AGENT_COUNT);
    expect(percentile(steadyStateLatencies, 0.95)).toBeLessThan(P95_TARGET_MS);
    expect(durationMs).toBeLessThan(30000);
  }, 90000);

  it("maintains consistency under concurrent reads plus reindex writes", async () => {
    const readers: CapsuleWorkerPayload[] = Array.from({ length: 6 }, (_, index) => ({
      mode: "capsule",
      agentId: `reader-${index + 1}`,
      dbPath,
      queries: QUERIES,
      iterations: 4,
      tokenBudget: 3000,
      sessionPrefix: `reader-${index + 1}`,
    }));

    const writer: ReindexWorkerPayload = {
      mode: "reindex",
      agentId: "writer-1",
      dbPath,
      iterations: 8,
      projectRoot: fixtureRoot,
      filePath: writerFilePath,
    };

    const results = await Promise.all([...readers.map((payload) => runWorker(payload)), runWorker(writer)]);
    const allErrors = results.flatMap((result) => result.errors);

    expect(allErrors).toEqual([]);
    expect(allErrors.filter((error) => /SQLITE_BUSY/i.test(error))).toEqual([]);

    const expectedSuccesses = readers.reduce((sum, reader) => sum + reader.iterations, 0) + writer.iterations;
    const successes = results.reduce((sum, result) => sum + result.successCount, 0);
    expect(successes).toBe(expectedSuccesses);

    const db = getDb(dbPath);
    const check = generateCapsule(db, {
      query: "concurrency churn",
      tokenBudget: 2500,
      sessionId: "post-concurrency-check",
      projectRoot: fixtureRoot,
    });
    closeDb(dbPath);

    expect(check.content.length).toBeGreaterThan(0);
    expect(check.metadata.tokensUsed).toBeGreaterThan(0);
  }, 90000);
});
