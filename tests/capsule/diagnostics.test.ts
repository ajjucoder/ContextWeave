import { describe, it, expect } from "vitest";
import { classifyQuery, diagnose } from "../../src/capsule/diagnostics.js";
import type { CapsuleMetadata, CompressionLevel } from "../../src/core/types.js";

function buildMetadata(overrides: Partial<CapsuleMetadata> = {}): CapsuleMetadata {
  const compressionBreakdown: Record<CompressionLevel, number> = { 0: 3, 1: 2, 2: 1, 3: 1 };

  return {
    query: "generateCapsule",
    mode: "feature",
    tokenBudget: 1000,
    tokensUsed: 600,
    symbolCount: 7,
    fileCount: 3,
    compressionBreakdown,
    observationCount: 0,
    quality: {
      pivotCount: 25,
      pivotsIncluded: 15,
      pivotCoverage: 0.6,
      dependencyCoverage: 0.55,
      coverageConfidence: 0.7,
      noiseRatio: 0.2,
      uncertaintyFlag: false,
      lowConfidence: false,
      uncertainty: "low",
      reasons: [],
      retrieval: {
        stageACandidateCount: 80,
        stageBSelectedCount: 40,
      },
    },
    generatedAt: Date.now(),
    ...overrides,
  };
}

describe("classifyQuery", () => {
  it("classifies task queries when action verbs are present", () => {
    expect(classifyQuery("find bugs in the capsule pipeline", 120)).toBe("task");
    expect(classifyQuery("implement a new MCP tool for symbol search", 120)).toBe("task");
  });

  it("classifies narrow queries for compact symbol-like lookups", () => {
    expect(classifyQuery("generateCapsule", 20)).toBe("narrow");
    expect(classifyQuery("SessionContext", 10)).toBe("narrow");
  });

  it("classifies broad queries for non-task multi-term lookups", () => {
    expect(classifyQuery("database schema migration tables indexes", 120)).toBe("broad");
  });
});

describe("diagnose", () => {
  it("identifies pivot flood bottlenecks", () => {
    const metadata = buildMetadata({
      quality: {
        ...buildMetadata().quality,
        retrieval: {
          stageACandidateCount: 250,
          stageBSelectedCount: 60,
        },
      },
    });

    const result = diagnose(metadata, [9, 8, 7, 6, 5, 4]);
    expect(result.bottleneck).toBe("pivot_flood");
    expect(result.pivotStats.topPivotScores).toEqual([9, 8, 7, 6, 5]);
    expect(result.pivotStats.bottomPivotScores).toEqual([8, 7, 6, 5, 4]);
  });

  it("identifies bfs noise when stage B scatters candidates", () => {
    const metadata = buildMetadata({
      symbolCount: 20,
      quality: {
        ...buildMetadata().quality,
        dependencyCoverage: 0.2,
        retrieval: {
          stageACandidateCount: 120,
          stageBSelectedCount: 110,
        },
      },
    });

    const result = diagnose(metadata, [4, 3, 2]);
    expect(result.bottleneck).toBe("bfs_noise");
  });

  it("identifies packing scatter when symbols are spread thinly across files", () => {
    const metadata = buildMetadata({
      symbolCount: 20,
      fileCount: 11,
    });

    const result = diagnose(metadata, [6, 5, 4, 3]);
    expect(result.bottleneck).toBe("packing_scatter");
  });

  it("identifies budget exhaustion for low pivot coverage at high budget use", () => {
    const metadata = buildMetadata({
      tokenBudget: 1000,
      tokensUsed: 980,
      quality: {
        ...buildMetadata().quality,
        pivotCoverage: 0.35,
      },
    });

    const result = diagnose(metadata, [4, 3, 2]);
    expect(result.bottleneck).toBe("budget_exhaustion");
    expect(result.coverageStats.tokenBudgetUsed).toBeGreaterThan(0.9);
  });

  it("returns healthy diagnostics when no bottleneck is detected", () => {
    const metadata = buildMetadata();

    const result = diagnose(metadata, [5, 4, 3]);
    expect(result.bottleneck).toBe("none");
    expect(result.bottlenecks).toHaveLength(0);
    expect(result.suggestion.length).toBeGreaterThan(0);
  });

  it("reports multiple bottlenecks when more than one condition is met simultaneously", () => {
    const metadata = buildMetadata({
      tokenBudget: 1000,
      tokensUsed: 980,
      fileCount: 12,
      symbolCount: 20,
      quality: {
        ...buildMetadata().quality,
        pivotCoverage: 0.3,
        retrieval: {
          stageACandidateCount: 260,
          stageBSelectedCount: 80,
        },
      },
    });

    const result = diagnose(metadata, [4, 3, 2]);
    expect(result.bottlenecks.length).toBeGreaterThanOrEqual(2);
    expect(result.bottlenecks).toContain("pivot_flood");
    expect(result.bottlenecks).toContain("budget_exhaustion");
    expect(result.bottleneck).toBe("pivot_flood");
  });

  it("uses preClassifiedIntent when provided instead of re-classifying", () => {
    const metadata = buildMetadata({ query: "generateCapsule" });
    const withoutOverride = diagnose(metadata, [5, 4, 3]);
    expect(withoutOverride.queryClass).toBe("narrow");

    const withOverride = diagnose(metadata, [5, 4, 3], "broad");
    expect(withOverride.queryClass).toBe("broad");

    const taskOverride = diagnose(metadata, [5, 4, 3], "task");
    expect(taskOverride.queryClass).toBe("task");
  });
});
