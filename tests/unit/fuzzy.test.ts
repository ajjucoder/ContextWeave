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

  it("returns exact match with score 1.0, contains-but-not-exact with score 0.9", () => {
    const exact = fuzzyMatch("validateEmail", ["validateEmail", "validateEmailAddress", "loadConfig"]);
    expect(exact[0]?.name).toBe("validateEmail");
    expect(exact[0]?.score).toBe(1.0);
    expect(exact[1]?.score).toBe(0.9);

    // "validate" is not an exact match for either "validateEmail" or "validateUser"
    const contains = fuzzyMatch("validate", candidates);
    expect(contains.length).toBeGreaterThanOrEqual(2);
    expect(contains.every((r) => r.score === 0.9 || r.score < 1.0)).toBe(true);
  });

  it("exact match is preferred over substring match", () => {
    const results = fuzzyMatch("Site", ["AllSitesPage", "Site", "SiteHeader"]);
    expect(results[0]?.name).toBe("Site");
    expect(results[0]?.score).toBe(1.0);
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
