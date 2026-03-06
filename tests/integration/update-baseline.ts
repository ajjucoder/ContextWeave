import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runEvalSuite,
  toBaseline,
  DEFAULT_BASELINE,
  type EvalBaseline,
} from "../eval/eval-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, "../eval/quality-baseline.json");

function loadExistingBaseline(): EvalBaseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as EvalBaseline;
}

function ratchetMetrics(
  existing: EvalBaseline["metrics"] | undefined,
  current: EvalBaseline["metrics"]
): EvalBaseline["metrics"] {
  if (!existing) return current;
  return {
    precision: Math.max(existing.precision, current.precision),
    recall: Math.max(existing.recall, current.recall),
    avgConfidence: Math.max(existing.avgConfidence, current.avgConfidence),
    avgTokenEfficiency: Math.max(existing.avgTokenEfficiency, current.avgTokenEfficiency),
    p95LatencyMs: Math.max(existing.p95LatencyMs, current.p95LatencyMs),
    taskSuccessRate: Math.max(existing.taskSuccessRate, current.taskSuccessRate),
    firstPassSuccessRate: Math.max(existing.firstPassSuccessRate, current.firstPassSuccessRate),
    correctionRate: Math.max(existing.correctionRate, current.correctionRate),
    avgTaskTokensToSuccess: Math.max(existing.avgTaskTokensToSuccess, current.avgTaskTokensToSuccess),
    avgTurnsToSuccess: Math.max(existing.avgTurnsToSuccess, current.avgTurnsToSuccess),
  };
}

async function main(): Promise<void> {
  const run = await runEvalSuite();
  const current = toBaseline(run);
  const existing = loadExistingBaseline() ?? DEFAULT_BASELINE;
  const sameVersion = existing.version === current.version;
  const replace = process.argv.includes("--replace");

  if (!sameVersion || replace) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");

    const reason = !sameVersion ? "version change" : "--replace";
    console.log(`Replaced baseline due to ${reason}: ${BASELINE_PATH}`);
    console.log(
      JSON.stringify(
        {
          existing,
          current,
          next: current,
        },
        null,
        2
      )
    );
    return;
  }

  const codebases: EvalBaseline["codebases"] = {};
  for (const [codebaseId, currentMetrics] of Object.entries(current.codebases)) {
    codebases[codebaseId] = ratchetMetrics(existing.codebases[codebaseId], currentMetrics);
  }

  const next: EvalBaseline = {
    version: current.version,
    metrics: ratchetMetrics(existing.metrics, current.metrics),
    codebases,
    updatedAt: current.updatedAt,
  };

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");

  console.log(`Updated baseline: ${BASELINE_PATH}`);
  console.log(
    JSON.stringify(
      {
        existing,
        current,
        next,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
