import { afterEach, describe, expect, it, vi } from "vitest";
import { initParser, parseFile } from "../../src/core/parser.js";

describe("parseFile timeout handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a timedOut result when tree-sitter aborts due to a timeout", () => {
    const parser = initParser("typescript");
    vi.spyOn(parser, "parse").mockReturnValueOnce(null as never);
    vi.spyOn(parser, "getTimeoutMicros").mockReturnValueOnce(5_000_000);

    const result = parseFile("timeout.ts", "export const answer = 42;", "typescript");

    expect(result.timedOut).toBe(true);
    expect(result.symbols).toHaveLength(0);
    expect(result.errors).toEqual([
      "Parse timed out for timeout.ts after 5000ms",
    ]);
  });
});
