import { describe, expect, it } from "vitest";
import type { CapsuleMode } from "../../src/core/types.js";
import { getModeWeights } from "../../src/capsule/modes.js";

const MODES: CapsuleMode[] = ["debug", "refactor", "feature", "review"];

describe("getModeWeights", () => {
  it("returns weights for all four capsule modes", () => {
    for (const mode of MODES) {
      const weights = getModeWeights(mode);

      expect(weights.distanceWeight).toBeGreaterThan(0);
      expect(weights.centralityWeight).toBeGreaterThan(0);
      expect(weights.recencyWeight).toBeGreaterThan(0);
      expect(weights.memoryWeight).toBeGreaterThan(0);
      expect(weights.exportBonus).toBeGreaterThan(0);
    }
  });

  it("normalizes each mode's weights to sum to 1.0", () => {
    for (const mode of MODES) {
      const weights = getModeWeights(mode);
      const total =
        weights.distanceWeight +
        weights.centralityWeight +
        weights.recencyWeight +
        weights.memoryWeight +
        weights.exportBonus;

      expect(total).toBeCloseTo(1, 10);
    }
  });
});
