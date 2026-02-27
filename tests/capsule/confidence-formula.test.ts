import { describe, it, expect } from "vitest";
import { computeCoverageConfidence } from "../../src/capsule/generator.js";

describe("computeCoverageConfidence", () => {
  it("returns high confidence when pivots are high-relevance", () => {
    const confidence = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 10,
      pivotsIncluded: 8,
      relevantPivotsIncluded: 8,
      totalRelevantPivots: 9,
      dependencyCoverage: 0.5,
      noiseRatio: 0.1,
      fileSummaryCount: 3,
    });
    expect(confidence).toBeGreaterThan(0.7);
  });

  it("returns lower confidence when only low-relevance pivots included", () => {
    const confidence = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 200,
      pivotsIncluded: 30,
      relevantPivotsIncluded: 5,
      totalRelevantPivots: 50,
      dependencyCoverage: 0.2,
      noiseRatio: 0.4,
      fileSummaryCount: 0,
    });
    expect(confidence).toBeLessThan(0.5);
  });

  it("boosts confidence when file summaries fill gaps", () => {
    const without = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 30,
      pivotsIncluded: 10,
      relevantPivotsIncluded: 10,
      totalRelevantPivots: 15,
      dependencyCoverage: 0.3,
      noiseRatio: 0.2,
      fileSummaryCount: 0,
    });
    const withSummaries = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 30,
      pivotsIncluded: 10,
      relevantPivotsIncluded: 10,
      totalRelevantPivots: 15,
      dependencyCoverage: 0.3,
      noiseRatio: 0.2,
      fileSummaryCount: 5,
    });
    expect(withSummaries).toBeGreaterThan(without);
  });

  it("clamps to [0, 1] range", () => {
    const max = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 1,
      pivotsIncluded: 1,
      relevantPivotsIncluded: 1,
      totalRelevantPivots: 1,
      dependencyCoverage: 1.0,
      noiseRatio: 0.0,
      fileSummaryCount: 100,
    });
    const min = computeCoverageConfidence({
      intent: "narrow",
      pivotCount: 0,
      pivotsIncluded: 0,
      relevantPivotsIncluded: 0,
      totalRelevantPivots: 1,
      dependencyCoverage: 0.0,
      noiseRatio: 1.0,
      fileSummaryCount: 0,
    });
    expect(max).toBeLessThanOrEqual(1.0);
    expect(min).toBeGreaterThanOrEqual(0.0);
  });

  it("uses module coverage for broad intent scoring", () => {
    const broad = computeCoverageConfidence({
      intent: "broad",
      pivotCount: 40,
      pivotsIncluded: 14,
      relevantPivotsIncluded: 12,
      totalRelevantPivots: 20,
      dependencyCoverage: 0.3,
      noiseRatio: 0.2,
      fileSummaryCount: 2,
      moduleCoverageStats: {
        packedClusters: 4,
        relevantClusters: 5,
        avgSymbolsPerFile: 2.2,
        maxSymbolsPerFile: 4,
      },
    });
    expect(broad).toBeGreaterThan(0.6);
  });

  it("uses story completeness for task intent scoring", () => {
    const task = computeCoverageConfidence({
      intent: "task",
      pivotCount: 30,
      pivotsIncluded: 12,
      relevantPivotsIncluded: 10,
      totalRelevantPivots: 18,
      dependencyCoverage: 0.25,
      noiseRatio: 0.15,
      fileSummaryCount: 1,
      moduleCoverageStats: {
        packedClusters: 3,
        relevantClusters: 4,
        avgSymbolsPerFile: 3,
        maxSymbolsPerFile: 4,
      },
    });
    expect(task).toBeGreaterThan(0.65);
  });
});
