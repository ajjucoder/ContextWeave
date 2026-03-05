import { describe, it, expect } from "vitest";
import { levenshteinDistance, correctTerm } from "../../src/utils/levenshtein.js";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns string length for empty vs non-empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("handles single character substitution", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
  });

  it("handles single character insertion", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  it("handles single character deletion", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("handles transposition (counts as 2 edits)", () => {
    expect(levenshteinDistance("ab", "ba")).toBe(2);
  });

  it("handles real-world typos", () => {
    expect(levenshteinDistance("kuberntes", "kubernetes")).toBe(1);
    expect(levenshteinDistance("autentication", "authentication")).toBe(1);
    expect(levenshteinDistance("databse", "database")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });
});

describe("correctTerm", () => {
  const knownTerms = ["kubernetes", "authentication", "database", "connection", "middleware"];

  it("returns exact match term unchanged", () => {
    expect(correctTerm("database", knownTerms, 2)).toBe("database");
  });

  it("corrects single-character typos", () => {
    expect(correctTerm("kuberntes", knownTerms, 2)).toBe("kubernetes");
    expect(correctTerm("databse", knownTerms, 2)).toBe("database");
  });

  it("returns null when no term is within max distance", () => {
    expect(correctTerm("zzzzzzz", knownTerms, 2)).toBeNull();
  });

  it("returns the closest match when multiple are within distance", () => {
    const result = correctTerm("connectio", knownTerms, 2);
    expect(result).toBe("connection");
  });

  it("respects maxDistance threshold", () => {
    expect(correctTerm("kuberntes", knownTerms, 0)).toBeNull();
    expect(correctTerm("kuberntes", knownTerms, 1)).toBe("kubernetes");
  });
});
