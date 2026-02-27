import { describe, it, expect } from "vitest";
import { computeCoverageConfidence } from "../../src/capsule/generator.js";

describe("computeCoverageConfidence", () => {
  it("returns high confidence when pivots are high-relevance", () => {
    const confidence = computeCoverageConfidence({
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
      pivotCount: 30,
      pivotsIncluded: 10,
      relevantPivotsIncluded: 10,
      totalRelevantPivots: 15,
      dependencyCoverage: 0.3,
      noiseRatio: 0.2,
      fileSummaryCount: 0,
    });
    const withSummaries = computeCoverageConfidence({
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
      pivotCount: 1,
      pivotsIncluded: 1,
      relevantPivotsIncluded: 1,
      totalRelevantPivots: 1,
      dependencyCoverage: 1.0,
      noiseRatio: 0.0,
      fileSummaryCount: 100,
    });
    const min = computeCoverageConfidence({
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
});
