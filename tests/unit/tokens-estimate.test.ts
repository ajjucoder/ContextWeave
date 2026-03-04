import { describe, it, expect } from "vitest";
import { estimateTokens } from "../../src/utils/tokens.js";

describe("estimateTokens fast path", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("rounds up via Math.ceil", () => {
    // length 7 / 3.5 = 2.0 exactly
    expect(estimateTokens("abcdefg")).toBe(2);
  });

  it("uses ceiling for non-integer results", () => {
    // length 8 / 3.5 = 2.28... → ceil = 3
    expect(estimateTokens("abcdefgh")).toBe(3);
  });

  it("is always >= 0 for non-empty input", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });
});
