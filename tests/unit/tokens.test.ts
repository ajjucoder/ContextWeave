import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("gpt-tokenizer", () => ({
  encode: vi.fn((text: string) => Array.from({ length: Math.max(1, Math.ceil(text.length / 4)) }, (_, i) => i)),
}));

async function loadTokens() {
  const tokens = await import("../../src/utils/tokens.js");
  const tokenizer = await import("gpt-tokenizer");
  return { ...tokens, encode: vi.mocked(tokenizer.encode) };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("countTokens", () => {
  it("estimates tokens from character count", async () => {
    const { countTokens } = await loadTokens();
    const text = "function hello(): string { return 'world'; }";
    const tokens = countTokens(text);
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(50);
  });

  it("returns 0 for empty string", async () => {
    const { countTokens } = await loadTokens();
    expect(countTokens("")).toBe(0);
  });

  it("keeps recently accessed entries in the cache when evicting", async () => {
    const { countTokens, encode } = await loadTokens();
    const cachedEntries = Array.from({ length: 2000 }, (_, index) => `entry-${index}-cache`);

    for (const entry of cachedEntries) {
      countTokens(entry);
    }

    expect(encode).toHaveBeenCalledTimes(2000);

    countTokens(cachedEntries[0]!);
    expect(encode).toHaveBeenCalledTimes(2000);

    countTokens("overflow-entry");
    expect(encode).toHaveBeenCalledTimes(2001);

    countTokens(cachedEntries[0]!);
    expect(encode).toHaveBeenCalledTimes(2001);

    countTokens(cachedEntries[1]!);
    expect(encode).toHaveBeenCalledTimes(2002);
  });

  it("evicts the oldest 10 percent of entries when the cache grows past the limit", async () => {
    const { countTokens, encode } = await loadTokens();
    const cachedEntries = Array.from({ length: 2000 }, (_, index) => `entry-${index}-eviction`);

    for (const entry of cachedEntries) {
      countTokens(entry);
    }

    expect(encode).toHaveBeenCalledTimes(2000);

    countTokens("overflow-entry");
    expect(encode).toHaveBeenCalledTimes(2001);

    countTokens(cachedEntries[0]!);
    countTokens(cachedEntries[199]!);
    expect(encode).toHaveBeenCalledTimes(2003);

    countTokens(cachedEntries[200]!);
    expect(encode).toHaveBeenCalledTimes(2003);
  });
});

describe("fitsInBudget", () => {
  it("returns true when text fits", async () => {
    const { fitsInBudget } = await loadTokens();
    expect(fitsInBudget("short", 100)).toBe(true);
  });

  it("returns false when text exceeds budget", async () => {
    const { fitsInBudget } = await loadTokens();
    const longText = "x".repeat(1000);
    expect(fitsInBudget(longText, 10)).toBe(false);
  });
});
