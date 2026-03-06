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
      queryTermCoverage: 0.9,
      retrievalSurfaceScore: 0.95,
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
      queryTermCoverage: 0.85,
      retrievalSurfaceScore: 0.9,
    });
    expect(task).toBeGreaterThan(0.65);
  });

  it("penalizes broad confidence when query coverage is thin", () => {
    const healthy = computeCoverageConfidence({
      intent: "broad",
      pivotCount: 12,
      pivotsIncluded: 8,
      relevantPivotsIncluded: 8,
      totalRelevantPivots: 8,
      dependencyCoverage: 0.4,
      noiseRatio: 0.1,
      fileSummaryCount: 1,
      moduleCoverageStats: {
        packedClusters: 3,
        relevantClusters: 3,
        avgSymbolsPerFile: 2,
        maxSymbolsPerFile: 3,
      },
      queryTermCoverage: 1,
      retrievalSurfaceScore: 1,
    });
    const thin = computeCoverageConfidence({
      intent: "broad",
      pivotCount: 2,
      pivotsIncluded: 2,
      relevantPivotsIncluded: 2,
      totalRelevantPivots: 2,
      dependencyCoverage: 1,
      noiseRatio: 0,
      fileSummaryCount: 0,
      moduleCoverageStats: {
        packedClusters: 1,
        relevantClusters: 1,
        avgSymbolsPerFile: 1,
        maxSymbolsPerFile: 1,
      },
      queryTermCoverage: 0.5,
      retrievalSurfaceScore: 0.35,
    });

    expect(thin).toBeLessThan(healthy);
    expect(thin).toBeLessThan(0.7);
  });

  it("penalizes task confidence when the retrieval surface is too narrow", () => {
    const healthy = computeCoverageConfidence({
      intent: "task",
      pivotCount: 16,
      pivotsIncluded: 10,
      relevantPivotsIncluded: 8,
      totalRelevantPivots: 10,
      dependencyCoverage: 0.5,
      noiseRatio: 0.1,
      fileSummaryCount: 1,
      moduleCoverageStats: {
        packedClusters: 4,
        relevantClusters: 4,
        avgSymbolsPerFile: 3,
        maxSymbolsPerFile: 4,
      },
      queryTermCoverage: 0.95,
      retrievalSurfaceScore: 0.9,
    });
    const thin = computeCoverageConfidence({
      intent: "task",
      pivotCount: 3,
      pivotsIncluded: 3,
      relevantPivotsIncluded: 3,
      totalRelevantPivots: 3,
      dependencyCoverage: 1,
      noiseRatio: 0,
      fileSummaryCount: 0,
      moduleCoverageStats: {
        packedClusters: 1,
        relevantClusters: 1,
        avgSymbolsPerFile: 1,
        maxSymbolsPerFile: 1,
      },
      queryTermCoverage: 0.5,
      retrievalSurfaceScore: 0.4,
    });

    expect(thin).toBeLessThan(healthy);
    expect(thin).toBeLessThan(0.72);
  });
});
