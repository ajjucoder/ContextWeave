import { describe, it, expect } from "vitest";
import { trigramSimilarity, fuzzyMatch } from "../../src/utils/fuzzy.js";

describe("trigramSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(trigramSimilarity("hello", "hello")).toBeCloseTo(1.0);
  });

  it("returns high score for similar strings", () => {
    const score = trigramSimilarity("validateEmail", "validateEmails");
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns low score for different strings", () => {
    const score = trigramSimilarity("foo", "xyz");
    expect(score).toBeLessThan(0.3);
  });

  it("handles case insensitivity", () => {
    expect(trigramSimilarity("Hello", "hello")).toBeCloseTo(1.0);
  });
});

describe("fuzzyMatch", () => {
  const candidates = ["validateEmail", "validateUser", "processOrder", "handleAuth", "loadConfig"];

  it("returns exact substring matches with score 1.0", () => {
    const results = fuzzyMatch("validate", candidates);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.score === 1.0)).toBe(true);
  });

  it("returns fuzzy matches above threshold", () => {
    const results = fuzzyMatch("validateEm", candidates, 0.4);
    expect(results.some((r) => r.name === "validateEmail")).toBe(true);
  });

  it("returns results sorted by score descending", () => {
    const results = fuzzyMatch("valid", candidates, 0.3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
    }
  });

  it("returns empty for no matches", () => {
    const results = fuzzyMatch("zzzzzzz", candidates, 0.7);
    expect(results).toHaveLength(0);
  });
});
