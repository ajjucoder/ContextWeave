import { describe, it, expect } from "vitest";
import { buildUncertainty, computeCoverageConfidence, confidenceToLabel } from "../../src/capsule/confidence.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("buildUncertainty calibration", () => {
  it("returns medium when 2 reasons but coverage is decent (>= 0.45)", () => {
    const uncertainty = buildUncertainty(true, 2, 0.55);
    expect(uncertainty).toBe("medium");
  });

  it("returns high only when 3+ reasons regardless of confidence", () => {
    const uncertainty = buildUncertainty(true, 3, 0.6);
    expect(uncertainty).toBe("high");
  });

  it("returns high when confidence is very low (< 0.35) even with 1 reason", () => {
    const uncertainty = buildUncertainty(true, 1, 0.25);
    expect(uncertainty).toBe("high");
  });

  it("returns high when 2 reasons AND confidence is low (< 0.45)", () => {
    const uncertainty = buildUncertainty(true, 2, 0.4);
    expect(uncertainty).toBe("high");
  });

  it("returns very_low when not low confidence and high coverage", () => {
    const uncertainty = buildUncertainty(false, 0, 0.8);
    expect(uncertainty).toBe("very_low");
  });

  it("returns medium when 1 reason and coverage is moderate", () => {
    const uncertainty = buildUncertainty(true, 1, 0.5);
    expect(uncertainty).toBe("medium");
  });
});

const BASE_PARAMS = {
  pivotCount: 5,
  pivotsIncluded: 4,
  relevantPivotsIncluded: 3,
  totalRelevantPivots: 4,
  dependencyCoverage: 0.8,
  noiseRatio: 0.1,
  fileSummaryCount: 2,
  queryTermCoverage: 0.9,
  retrievalSurfaceScore: 0.9,
};

describe("computeCoverageConfidence — escape hatch removal", () => {
  it("narrow intent at 18% utilization must be <= 0.40 (LOW)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.18,
    });
    expect(conf).toBeLessThanOrEqual(0.40);
    expect(confidenceToLabel(conf)).toBe("LOW");
  });

  it("broad intent at 14% utilization must be <= 0.40 (LOW)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "broad",
      tokenUtilization: 0.14,
    });
    expect(conf).toBeLessThanOrEqual(0.40);
    expect(confidenceToLabel(conf)).toBe("LOW");
  });

  it("symbol-lookup intent at 18% utilization must be <= 0.40 (LOW)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "symbol-lookup",
      tokenUtilization: 0.18,
    });
    expect(conf).toBeLessThanOrEqual(0.40);
    expect(confidenceToLabel(conf)).toBe("LOW");
  });

  it("45% utilization with good pivotCoverage must be <= 0.62 (MEDIUM or LOW)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.45,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.62);
    expect(["LOW", "MEDIUM"]).toContain(confidenceToLabel(conf));
  });

  it("80% utilization with good pivotCoverage can reach HIGH (>= 0.75)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
    });
    expect(conf).toBeGreaterThan(0.60);
  });

  it("task intent at 18% utilization must be <= 0.40 (caps apply to all intents)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "task",
      tokenUtilization: 0.18,
    });
    expect(conf).toBeLessThanOrEqual(0.40);
    expect(confidenceToLabel(conf)).toBe("LOW");
  });

  it("feature intent at 40% utilization must be <= 0.62", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.40,
    });
    expect(conf).toBeLessThanOrEqual(0.62);
  });

  it("confidence never exceeds 0.75 when utilization is at boundary (0.60)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.60,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.90);
  });

  it("confidence never exceeds 0.90 when pivotCoverage <= 0.60", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.90,
      pivotCount: 10,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.90);
  });
});

describe("confidenceToLabel three-tier", () => {
  it("returns LOW for confidence < 0.45", () => {
    expect(confidenceToLabel(0.0)).toBe("LOW");
    expect(confidenceToLabel(0.30)).toBe("LOW");
    expect(confidenceToLabel(0.44)).toBe("LOW");
  });

  it("returns MEDIUM for confidence 0.45–0.74", () => {
    expect(confidenceToLabel(0.45)).toBe("MEDIUM");
    expect(confidenceToLabel(0.60)).toBe("MEDIUM");
    expect(confidenceToLabel(0.74)).toBe("MEDIUM");
  });

  it("returns HIGH for confidence >= 0.75", () => {
    expect(confidenceToLabel(0.75)).toBe("HIGH");
    expect(confidenceToLabel(0.90)).toBe("HIGH");
    expect(confidenceToLabel(1.0)).toBe("HIGH");
  });
});

describe("compactButGrounded removed from source", () => {
  it("confidence.ts does not contain compactButGrounded", () => {
    const src = readFileSync(
      join(__dirname, "../../src/capsule/confidence.ts"),
      "utf8"
    );
    expect(src).not.toContain("compactButGrounded");
  });

  it("confidence.ts does not contain thinRetrieval variable declaration", () => {
    const src = readFileSync(
      join(__dirname, "../../src/capsule/confidence.ts"),
      "utf8"
    );
    expect(src).not.toContain("thinRetrieval");
  });
});
