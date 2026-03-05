import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BASELINE,
  runEvalSuite,
  toBaseline,
  type EvalBaseline,
} from "../eval/eval-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, "../eval/quality-baseline.json");

const TOLERANCE = {
  precision: 0.02,
  recall: 0.02,
  avgConfidence: 0.02,
  avgTokenEfficiency: 0.03,
  // Full-suite parallelism can add heavy contention/jitter versus isolated eval runs.
  p95LatencyMs: 45,
};

function loadBaseline(): EvalBaseline {
  if (existsSync(BASELINE_PATH)) {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as EvalBaseline;
  }

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(DEFAULT_BASELINE, null, 2) + "\n");
  return DEFAULT_BASELINE;
}

function expectNoRegression(current: EvalBaseline["metrics"], baseline: EvalBaseline["metrics"], label: string): void {
  expect(current.precision, `${label}: precision`).toBeGreaterThanOrEqual(
    baseline.precision - TOLERANCE.precision
  );
  expect(current.recall, `${label}: recall`).toBeGreaterThanOrEqual(
    baseline.recall - TOLERANCE.recall
  );
  expect(current.avgConfidence, `${label}: avgConfidence`).toBeGreaterThanOrEqual(
    baseline.avgConfidence - TOLERANCE.avgConfidence
  );
  expect(current.avgTokenEfficiency, `${label}: avgTokenEfficiency`).toBeGreaterThanOrEqual(
    baseline.avgTokenEfficiency - TOLERANCE.avgTokenEfficiency
  );
  expect(current.p95LatencyMs, `${label}: p95LatencyMs`).toBeLessThanOrEqual(
    baseline.p95LatencyMs + TOLERANCE.p95LatencyMs
  );
}

const baselineExistedBefore = existsSync(BASELINE_PATH);
const baseline = loadBaseline();
let current: EvalBaseline;

beforeAll(async () => {
  const run = await runEvalSuite();
  current = toBaseline(run);
}, 120000);

describe("quality ratchet - no regression allowed", () => {
  it("baseline file is not using initial defaults (would mask regressions)", () => {
    if (!baselineExistedBefore) {
      expect.fail(
        "quality-baseline.json was missing and had to be recreated with low defaults. " +
        "Run the full test suite once to establish a real baseline, then commit the file."
      );
    }
    const defaultDate = new Date(0).toISOString();
    expect(baseline.updatedAt).not.toBe(defaultDate);
  });

  it("overall eval metrics do not regress beyond tolerance", () => {
    expectNoRegression(current.metrics, baseline.metrics, "overall");
  });

  it("per-codebase eval metrics do not regress beyond tolerance", () => {
    for (const [codebaseId, baselineMetrics] of Object.entries(baseline.codebases)) {
      const currentMetrics = current.codebases[codebaseId];
      expect(currentMetrics, `missing current metrics for ${codebaseId}`).toBeDefined();
      if (!currentMetrics) continue;
      expectNoRegression(currentMetrics, baselineMetrics, codebaseId);
    }
  });
});
