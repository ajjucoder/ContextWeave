import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { closeDb, getDb } from "../../src/db/connection.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const WORKER_SCRIPT = resolve(PROJECT_ROOT, "bench/workers/concurrent-capsule-worker.ts");
const FIXTURE_DIR = resolve(__dirname, "../fixtures");

const AGENT_COUNT = 10;
const ITERATIONS_PER_AGENT = 4;
const QUERIES = ["UserService", "validateEmail", "loadUser", "getDefaultRole"];

interface WorkerResult {
  agentId: string;
  latenciesMs: number[];
  successCount: number;
  errors: string[];
}

let tempRoot = "";
let dbPath = "";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

beforeAll(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), "cw-concurrency-"));
  const cwDir = join(tempRoot, ".contextweave");
  mkdirSync(cwDir, { recursive: true });
  dbPath = join(cwDir, "contextweave.db");

  const db = getDb(dbPath);
  runMigrations(db);
  await indexProject(db, FIXTURE_DIR);
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
    const executions = payloads.map(async (payload) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--import", "tsx", WORKER_SCRIPT, JSON.stringify(payload)],
        {
          cwd: PROJECT_ROOT,
          maxBuffer: 4 * 1024 * 1024,
        }
      );
      return JSON.parse(stdout.trim()) as WorkerResult;
    });
    const results = await Promise.all(executions);
    const durationMs = Date.now() - startedAt;

    const allErrors = results.flatMap((result) => result.errors);
    expect(allErrors).toEqual([]);

    const successes = results.reduce((sum, result) => sum + result.successCount, 0);
    const expectedCalls = AGENT_COUNT * ITERATIONS_PER_AGENT;
    expect(successes).toBe(expectedCalls);

    const latencies = results.flatMap((result) => result.latenciesMs);
    expect(latencies.length).toBe(expectedCalls);
    expect(percentile(latencies, 0.95)).toBeLessThan(1500);
    expect(durationMs).toBeLessThan(30000);
  }, 90000);
});
