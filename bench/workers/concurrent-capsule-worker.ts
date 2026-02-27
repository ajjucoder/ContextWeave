import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { closeDb, getDb } from "../../src/db/connection.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { indexSingleFile } from "../../src/core/indexer.js";

interface CapsulePayload {
  mode?: "capsule";
  agentId: string;
  dbPath: string;
  queries: string[];
  iterations: number;
  tokenBudget: number;
  sessionPrefix: string;
}

interface ReindexPayload {
  mode: "reindex";
  agentId: string;
  dbPath: string;
  iterations: number;
  projectRoot: string;
  filePath: string;
}

type WorkerPayload = CapsulePayload | ReindexPayload;

interface WorkerResult {
  agentId: string;
  latenciesMs: number[];
  successCount: number;
  errors: string[];
}

function parsePayload(raw: string | undefined): WorkerPayload {
  if (!raw) {
    throw new Error("missing worker payload");
  }
  const parsed = JSON.parse(raw) as Partial<WorkerPayload>;
  if (!parsed.agentId || !parsed.dbPath) {
    throw new Error("invalid worker payload");
  }

  const mode = parsed.mode ?? "capsule";
  if (mode === "reindex") {
    if (!parsed.projectRoot || !parsed.filePath) {
      throw new Error("invalid reindex payload");
    }
    return {
      mode: "reindex",
      agentId: parsed.agentId,
      dbPath: parsed.dbPath,
      iterations: typeof parsed.iterations === "number" ? parsed.iterations : 1,
      projectRoot: parsed.projectRoot,
      filePath: parsed.filePath,
    };
  }

  if (!Array.isArray(parsed.queries)) {
    throw new Error("invalid capsule payload");
  }

  return {
    mode: "capsule",
    agentId: parsed.agentId,
    dbPath: parsed.dbPath,
    queries: parsed.queries,
    iterations: typeof parsed.iterations === "number" ? parsed.iterations : 1,
    tokenBudget: typeof parsed.tokenBudget === "number" ? parsed.tokenBudget : 4000,
    sessionPrefix: parsed.sessionPrefix ?? parsed.agentId,
  };
}

function run(payload: WorkerPayload): WorkerResult {
  const db = getDb(payload.dbPath);
  const latenciesMs: number[] = [];
  const errors: string[] = [];
  let successCount = 0;

  try {
    if (payload.mode === "reindex") {
      for (let i = 0; i < payload.iterations; i++) {
        const start = performance.now();
        try {
          writeFileSync(payload.filePath, `export function churn_${i}() { return ${i}; }\n`, "utf-8");
          indexSingleFile(db, payload.filePath, payload.projectRoot);
          latenciesMs.push(performance.now() - start);
          successCount += 1;
        } catch (error) {
          latenciesMs.push(performance.now() - start);
          errors.push(
            `agent ${payload.agentId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else {
      for (let i = 0; i < payload.iterations; i++) {
        const query = payload.queries[i % payload.queries.length] ?? payload.queries[0] ?? "";
        const start = performance.now();
        try {
          const result = generateCapsule(db, {
            query,
            tokenBudget: payload.tokenBudget,
            sessionId: `${payload.sessionPrefix}-${i}`,
          });
          latenciesMs.push(performance.now() - start);
          if (result.content.length === 0 || result.metadata.tokensUsed <= 0) {
            errors.push(`agent ${payload.agentId}: empty capsule for query "${query}"`);
            continue;
          }
          successCount += 1;
        } catch (error) {
          latenciesMs.push(performance.now() - start);
          errors.push(
            `agent ${payload.agentId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  } finally {
    closeDb(payload.dbPath);
  }

  return {
    agentId: payload.agentId,
    latenciesMs,
    successCount,
    errors,
  };
}

try {
  const payload = parsePayload(process.argv[2]);
  const result = run(payload);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `concurrent-capsule-worker failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
