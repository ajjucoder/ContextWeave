import { describe, it, expect } from "vitest";
import { buildUncertainty, computeCoverageConfidence } from "../../src/capsule/confidence.js";

describe("buildUncertainty 5-level calibration", () => {
  it("returns very_low when no issues and high coverage", () => {
    const result = buildUncertainty(false, 0, 0.8);
    expect(result).toBe("very_low");
  });

  it("returns low when no issues but moderate coverage", () => {
    const result = buildUncertainty(false, 0, 0.5);
    expect(result).toBe("low");
  });

  it("returns critical when 4 or more reasons", () => {
    const result = buildUncertainty(true, 4, 0.5);
    expect(result).toBe("critical");
  });

  it("returns critical when coverage is below 0.2", () => {
    const result = buildUncertainty(true, 1, 0.15);
    expect(result).toBe("critical");
  });

  it("returns high for 3 reasons (below critical threshold)", () => {
    const result = buildUncertainty(true, 3, 0.5);
    expect(result).toBe("high");
  });

  it("returns high when coverage below 0.35 even with few reasons", () => {
    const result = buildUncertainty(true, 1, 0.30);
    expect(result).toBe("high");
  });

  it("returns medium for 2 reasons with moderate coverage", () => {
    const result = buildUncertainty(true, 2, 0.55);
    expect(result).toBe("medium");
  });

  it("returns medium for 1 reason with moderate coverage", () => {
    const result = buildUncertainty(true, 1, 0.50);
    expect(result).toBe("medium");
  });

  it("bumps uncertainty one level up when token utilization is very high", () => {
    // very_low → low when tokenUtilization >= 0.95
    const result = buildUncertainty(false, 0, 0.8, 0.97);
    expect(result).toBe("low");
  });

  it("bumps medium to high when token utilization is very high", () => {
    const result = buildUncertainty(true, 1, 0.50, 0.96);
    expect(result).toBe("high");
  });

  it("does not bump when token utilization is normal", () => {
    const result = buildUncertainty(false, 0, 0.8, 0.70);
    expect(result).toBe("very_low");
  });

  it("keeps broad confidence above the medium-risk floor when structure is healthy", () => {
    const result = computeCoverageConfidence({
      intent: "broad",
      pivotCount: 10,
      pivotsIncluded: 8,
      relevantPivotsIncluded: 8,
      totalRelevantPivots: 8,
      dependencyCoverage: 1,
      noiseRatio: 0,
      fileSummaryCount: 0,
      queryTermCoverage: 0.34,
      retrievalSurfaceScore: 0.95,
      moduleCoverageStats: {
        packedClusters: 4,
        relevantClusters: 4,
        avgSymbolsPerFile: 2.8,
        maxSymbolsPerFile: 3,
      },
    });

    expect(result).toBeGreaterThanOrEqual(0.6);
  });
});
