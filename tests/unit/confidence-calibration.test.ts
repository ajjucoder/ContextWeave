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

  it("confidence at tokenUtilization 0.60 is uncapped by utilization gate", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.60,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    const cappedConf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "feature",
      tokenUtilization: 0.59,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeGreaterThan(cappedConf);
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

describe("computeCoverageConfidence — graduated utilization caps", () => {
  it("15% utilization caps at 0.30 (tier 1: < 0.20)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.15,
    });
    expect(conf).toBeLessThanOrEqual(0.30);
  });

  it("25% utilization caps at 0.40 (tier 2: < 0.30)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.25,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.40);
  });

  it("35% utilization caps at 0.50 (tier 3: < 0.40)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.35,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.50);
  });

  it("45% utilization caps at 0.60 (tier 4: < 0.50)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.45,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.60);
  });

  it("55% utilization caps at 0.70 (tier 5: < 0.60)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.55,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.70);
  });

  it("graduated caps apply to broad intent (no intent-gated bypass)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "broad",
      tokenUtilization: 0.25,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.40);
  });

  it("graduated caps apply to task intent (no intent-gated bypass)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "task",
      tokenUtilization: 0.35,
      pivotCount: 5,
      pivotsIncluded: 5,
    });
    expect(conf).toBeLessThanOrEqual(0.50);
  });
});

describe("computeCoverageConfidence — pivot coverage gate (all intents)", () => {
  it("pivotCoverage 0.20 caps at 0.45 for narrow intent", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.90,
      pivotCount: 10,
      pivotsIncluded: 2,
    });
    expect(conf).toBeLessThanOrEqual(0.45);
  });

  it("pivotCoverage 0.20 caps at 0.45 for broad intent", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "broad",
      tokenUtilization: 0.90,
      pivotCount: 10,
      pivotsIncluded: 2,
    });
    expect(conf).toBeLessThanOrEqual(0.45);
  });

  it("pivotCoverage 0.20 caps at 0.45 for task intent", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "task",
      tokenUtilization: 0.90,
      pivotCount: 10,
      pivotsIncluded: 2,
    });
    expect(conf).toBeLessThanOrEqual(0.45);
  });

  it("pivotCoverage 0.40 caps at 0.60 (tier 2: < 0.50)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.90,
      pivotCount: 10,
      pivotsIncluded: 4,
    });
    expect(conf).toBeLessThanOrEqual(0.60);
  });

  it("pivotCoverage 0.65 caps at 0.80 (tier 3: < 0.70)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.90,
      pivotCount: 20,
      pivotsIncluded: 13,
    });
    expect(conf).toBeLessThanOrEqual(0.80);
  });

  it("pivotCoverage 0.80 has no pivot coverage cap", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.90,
      pivotCount: 10,
      pivotsIncluded: 8,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
    });
    expect(conf).toBeGreaterThan(0.60);
  });
});

describe("computeCoverageConfidence — query-term validation", () => {
  it("drops confidence when no query terms match packed symbol names (narrow)", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
      packedSymbolNames: ["unrelatedFoo", "barBaz", "quxQuux"],
      queryTerms: ["userservice", "auth", "login"],
    });
    expect(conf).toBeLessThanOrEqual(0.50);
  });

  it("does not drop confidence when query terms match packed symbol names", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
      packedSymbolNames: ["userService", "authLogin", "loginHandler"],
      queryTerms: ["user", "login"],
    });
    expect(conf).toBeGreaterThan(0.50);
  });

  it("query-term validation skips broad intent even when no terms match", () => {
    const noTermsConf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "broad",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
      packedSymbolNames: ["unrelatedFoo", "barBaz"],
      queryTerms: ["completely", "different", "terms"],
    });
    const withTermsConf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "broad",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
    });
    expect(noTermsConf).toBeGreaterThan(0.50);
    expect(noTermsConf).toBeCloseTo(withTermsConf, 2);
  });

  it("query-term validation is skipped when packedSymbolNames is absent", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
      queryTerms: ["unmatched", "terms"],
    });
    expect(conf).toBeGreaterThan(0.50);
  });

  it("query-term validation handles camelCase symbol names via tokenization", () => {
    const conf = computeCoverageConfidence({
      ...BASE_PARAMS,
      intent: "narrow",
      tokenUtilization: 0.80,
      pivotCount: 5,
      pivotsIncluded: 5,
      relevantPivotsIncluded: 4,
      totalRelevantPivots: 4,
      packedSymbolNames: ["computeCoverageConfidence", "buildUncertainty"],
      queryTerms: ["compute", "coverage"],
    });
    expect(conf).toBeGreaterThan(0.50);
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
