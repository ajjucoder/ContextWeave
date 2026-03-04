import { describe, it, expect } from "vitest";
import { buildUncertainty } from "../../src/capsule/confidence.js";

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
