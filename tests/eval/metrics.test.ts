import { describe, expect, it } from "vitest";
import {
  aggregateMetrics,
  aggregateMetricsWithTasks,
  computeQueryMetrics,
  computeTaskMetrics,
  computeTokenEfficiency,
} from "./metrics.js";

describe("eval metrics", () => {
  it("computes token efficiency", () => {
    expect(computeTokenEfficiency(200, 1000)).toBeCloseTo(0.8, 6);
    expect(computeTokenEfficiency(1200, 1000)).toBe(0);
    expect(computeTokenEfficiency(100, 0)).toBe(0);
  });

  it("computes file and symbol hit metrics with top-k", () => {
    const metrics = computeQueryMetrics({
      expectedFiles: ["core/indexer.ts", "core/parser.ts"],
      expectedSymbols: ["indexProject", "parseFile"],
      actualFiles: ["core/indexer.ts", "core/types.ts", "core/parser.ts", "capsule/generator.ts"],
      actualSymbols: ["indexProject", "computeClusters", "parseFile", "generateCapsule"],
      latencyMs: 11,
      tokensUsed: 400,
      rawTokenCount: 2000,
      coverageConfidence: 0.9,
      options: { fileTopK: 3, symbolTopK: 3 },
    });

    expect(metrics.fileRecall).toBe(1);
    expect(metrics.symbolRecall).toBe(1);
    expect(metrics.filePrecision).toBeCloseTo(2 / 3, 6);
    expect(metrics.symbolPrecision).toBeCloseTo(2 / 3, 6);
    expect(metrics.precision).toBeCloseTo(2 / 3, 6);
    expect(metrics.recall).toBe(1);
  });

  it("aggregates query metrics", () => {
    const q1 = computeQueryMetrics({
      expectedFiles: ["a.ts"],
      expectedSymbols: [],
      actualFiles: ["a.ts", "b.ts"],
      actualSymbols: [],
      latencyMs: 10,
      tokensUsed: 200,
      rawTokenCount: 1000,
      coverageConfidence: 0.8,
    });

    const q2 = computeQueryMetrics({
      expectedFiles: ["x.ts"],
      expectedSymbols: [],
      actualFiles: ["y.ts"],
      actualSymbols: [],
      latencyMs: 20,
      tokensUsed: 400,
      rawTokenCount: 1000,
      coverageConfidence: 0.6,
    });

    const aggregate = aggregateMetrics([q1, q2]);

    expect(aggregate.queryCount).toBe(2);
    expect(aggregate.precision).toBeCloseTo((0.5 + 0) / 2, 6);
    expect(aggregate.recall).toBeCloseTo((1 + 0) / 2, 6);
    expect(aggregate.avgConfidence).toBeCloseTo(0.7, 6);
    expect(aggregate.avgTokenEfficiency).toBeCloseTo((0.8 + 0.6) / 2, 6);
    expect(aggregate.avgLatencyMs).toBeCloseTo(15, 6);
    expect(aggregate.p95LatencyMs).toBe(20);
    expect(aggregate.taskCount).toBe(0);
  });

  it("computes task metrics with correction attempts", () => {
    const task = computeTaskMetrics([
      { success: false, tokensUsed: 400 },
      { success: true, tokensUsed: 250 },
      { success: true, tokensUsed: 100 },
    ]);

    expect(task.success).toBe(true);
    expect(task.firstPassSuccess).toBe(false);
    expect(task.correction).toBe(true);
    expect(task.turnsToSuccess).toBe(2);
    expect(task.tokensToSuccess).toBe(650);
  });

  it("aggregates task metrics alongside query metrics", () => {
    const query = computeQueryMetrics({
      expectedFiles: ["a.ts"],
      expectedSymbols: [],
      actualFiles: ["a.ts"],
      actualSymbols: [],
      latencyMs: 10,
      tokensUsed: 200,
      rawTokenCount: 1000,
      coverageConfidence: 0.8,
    });

    const aggregate = aggregateMetricsWithTasks(
      [query],
      [
        computeTaskMetrics([
          { success: false, tokensUsed: 400 },
          { success: true, tokensUsed: 200 },
        ]),
        computeTaskMetrics([
          { success: true, tokensUsed: 150 },
        ]),
      ]
    );

    expect(aggregate.taskCount).toBe(2);
    expect(aggregate.taskSuccessRate).toBe(1);
    expect(aggregate.firstPassSuccessRate).toBe(0.5);
    expect(aggregate.correctionRate).toBe(0.5);
    expect(aggregate.avgTaskTokensToSuccess).toBeCloseTo((600 + 150) / 2, 6);
    expect(aggregate.avgTurnsToSuccess).toBeCloseTo((2 + 1) / 2, 6);
  });
});
