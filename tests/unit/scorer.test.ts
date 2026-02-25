import { describe, it, expect } from "vitest";
import { scoreNode } from "../../src/capsule/scorer.js";

describe("scoreNode", () => {
  const baseParams = {
    distance: 1,
    centrality: 0.01,
    lastSeen: Date.now(),
    observationCount: 0,
    isExported: false,
    mode: "feature" as const,
  };

  it("applies explicit hub penalty", () => {
    const normal = scoreNode({ ...baseParams, hubPenalty: 1 });
    const dampened = scoreNode({ ...baseParams, hubPenalty: 0.2 });

    expect(dampened).toBeLessThan(normal);
  });

  it("increases score with lexical and locality boosts", () => {
    const baseline = scoreNode({ ...baseParams, lexicalBoost: 1, localityBoost: 1 });
    const boosted = scoreNode({ ...baseParams, lexicalBoost: 1.5, localityBoost: 1.2 });

    expect(boosted).toBeGreaterThan(baseline);
  });

  it("keeps non-zero score even when centrality is zero", () => {
    const score = scoreNode({ ...baseParams, centrality: 0 });
    expect(score).toBeGreaterThan(0);
  });
});
