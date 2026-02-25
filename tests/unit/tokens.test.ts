import { describe, it, expect } from "vitest";
import { countTokens, fitsInBudget } from "../../src/utils/tokens.js";

describe("countTokens", () => {
  it("estimates tokens from character count", () => {
    const text = "function hello(): string { return 'world'; }";
    const tokens = countTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(50);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
});

describe("fitsInBudget", () => {
  it("returns true when text fits", () => {
    expect(fitsInBudget("short", 100)).toBe(true);
  });

  it("returns false when text exceeds budget", () => {
    const longText = "x".repeat(1000);
    expect(fitsInBudget(longText, 10)).toBe(false);
  });
});
