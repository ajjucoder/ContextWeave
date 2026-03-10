import { describe, it, expect } from "vitest";
import {
  parseDelimitedRegex,
  detectBraceExpansion,
  buildRegex,
} from "../../src/mcp/tools/search.js";

describe("parseDelimitedRegex", () => {
  it("parses /pattern/flags correctly", () => {
    expect(parseDelimitedRegex("/foo/i")).toEqual({ pattern: "foo", flags: "i" });
  });

  it("parses /pattern/ with no flags", () => {
    expect(parseDelimitedRegex("/foo/")).toEqual({ pattern: "foo", flags: "" });
  });

  it("returns null for plain string without delimiters", () => {
    expect(parseDelimitedRegex("foo")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseDelimitedRegex("")).toBeNull();
  });

  it("returns null for a lone slash", () => {
    expect(parseDelimitedRegex("/")).toBeNull();
  });

  it("returns null for invalid flag characters", () => {
    expect(parseDelimitedRegex("/foo/xyz")).toBeNull();
  });

  it("handles multiple valid flags", () => {
    expect(parseDelimitedRegex("/test/gim")).toEqual({ pattern: "test", flags: "gim" });
  });

  it("handles all recognized flag characters", () => {
    const result = parseDelimitedRegex("/test/dgimsuvy");
    expect(result).not.toBeNull();
    expect(result!.flags).toBe("dgimsuvy");
  });

  it("parses pattern containing regex metacharacters", () => {
    const result = parseDelimitedRegex("/foo.*bar/");
    expect(result).toEqual({ pattern: "foo.*bar", flags: "" });
  });

  it("treats last slash as the closing delimiter", () => {
    const result = parseDelimitedRegex("/foo/bar/i");
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("foo/bar");
    expect(result!.flags).toBe("i");
  });

  it("returns null when string starts with non-slash", () => {
    expect(parseDelimitedRegex("^foo/")).toBeNull();
  });

  it("handles empty pattern between slashes", () => {
    const result = parseDelimitedRegex("//");
    expect(result).toEqual({ pattern: "", flags: "" });
  });
});

describe("detectBraceExpansion", () => {
  it("throws for {foo,bar} brace expansion", () => {
    expect(() => detectBraceExpansion("{foo,bar}")).toThrow(
      /not supported in search patterns/
    );
  });

  it("error message includes regex alternation suggestion", () => {
    expect(() => detectBraceExpansion("{foo,bar}")).toThrow(/\(foo\|bar\)/);
  });

  it("throws for three-alternative brace expansion", () => {
    expect(() => detectBraceExpansion("{a,b,c}")).toThrow(/not supported/);
  });

  it("three-alternative suggestion uses all parts joined by pipes", () => {
    expect(() => detectBraceExpansion("{a,b,c}")).toThrow(/\(a\|b\|c\)/);
  });

  it("throws when braces appear mid-pattern", () => {
    expect(() => detectBraceExpansion("import {foo,bar} from")).toThrow(
      /not supported in search patterns/
    );
  });

  it("does not throw for empty braces", () => {
    expect(() => detectBraceExpansion("{}")).not.toThrow();
  });

  it("does not throw for single-element braces without comma", () => {
    expect(() => detectBraceExpansion("{foo}")).not.toThrow();
  });

  it("does not throw for unmatched opening brace", () => {
    expect(() => detectBraceExpansion("interface{")).not.toThrow();
  });

  it("does not throw for unmatched closing brace", () => {
    expect(() => detectBraceExpansion("}")).not.toThrow();
  });

  it("does not throw for plain patterns", () => {
    expect(() => detectBraceExpansion("foobar")).not.toThrow();
  });

  it("does not throw for regex patterns without brace expansion", () => {
    expect(() => detectBraceExpansion("function\\s+\\w+")).not.toThrow();
  });

  it("trims whitespace from alternatives in suggestion", () => {
    expect(() => detectBraceExpansion("{ foo , bar }")).toThrow(/\(foo\|bar\)/);
  });
});

describe("buildRegex", () => {
  it("returns null when use_regex is false and pattern is not delimited", () => {
    expect(buildRegex("hello", false, true)).toBeNull();
  });

  it("returns null for empty string when use_regex is false", () => {
    expect(buildRegex("", false, true)).toBeNull();
  });

  it("builds regex from /pattern/flags syntax regardless of use_regex", () => {
    const regex = buildRegex("/foo/m", false, true);
    expect(regex).not.toBeNull();
    expect(regex!.source).toBe("foo");
    expect(regex!.flags).toContain("m");
  });

  it("always includes the g flag", () => {
    const regex = buildRegex("/test/", false, true);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain("g");
  });

  it("preserves m flag from delimited pattern", () => {
    const regex = buildRegex("/test/m", false, true);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain("m");
    expect(regex!.flags).toContain("g");
  });

  it("adds case-insensitive flag when caseSensitive is false", () => {
    const regex = buildRegex("/foo/", false, false);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain("i");
  });

  it("does not add i flag when caseSensitive is true", () => {
    const regex = buildRegex("/foo/", false, true);
    expect(regex).not.toBeNull();
    expect(regex!.flags).not.toContain("i");
  });

  it("strips existing i flag before re-applying when caseSensitive is true", () => {
    const regex = buildRegex("/foo/i", false, true);
    expect(regex).not.toBeNull();
    expect(regex!.flags).not.toContain("i");
    expect(regex!.source).toBe("foo");
  });

  it("builds regex from plain query when use_regex is true", () => {
    const regex = buildRegex("foo.*bar", true, true);
    expect(regex).not.toBeNull();
    expect(regex!.source).toBe("foo.*bar");
  });

  it("adds i flag when use_regex is true and caseSensitive is false", () => {
    const regex = buildRegex("foo", true, false);
    expect(regex).not.toBeNull();
    expect(regex!.flags).toContain("i");
  });

  it("produces a functional RegExp that matches correctly", () => {
    const regex = buildRegex("/hel+o/", false, false);
    expect(regex).not.toBeNull();
    expect(regex!.test("Hello world")).toBe(true);
    expect(regex!.test("world")).toBe(false);
  });

  it("produces a functional RegExp for use_regex path", () => {
    const regex = buildRegex("\\d+", true, true);
    expect(regex).not.toBeNull();
    expect(regex!.test("abc123")).toBe(true);
    expect(regex!.test("abc")).toBe(false);
  });
});
