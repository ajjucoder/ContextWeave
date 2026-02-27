import { performance } from "node:perf_hooks";
import { closeDb, getDb } from "../../src/db/connection.js";
import { generateCapsule } from "../../src/capsule/generator.js";

interface WorkerPayload {
  agentId: string;
  dbPath: string;
  queries: string[];
  iterations: number;
  tokenBudget: number;
  sessionPrefix: string;
}

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
  if (!parsed.agentId || !parsed.dbPath || !Array.isArray(parsed.queries)) {
    throw new Error("invalid worker payload");
  }

  return {
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
