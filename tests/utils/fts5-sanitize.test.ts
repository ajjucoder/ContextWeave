/**
 * VAL-SEC-004: FTS5 Sanitization Tests
 *
 * Security Findings #4 and #5 - FTS5 Query Injection Prevention
 *
 * These tests validate that user input is properly sanitized before
 * being used in SQLite FTS5 MATCH expressions to prevent:
 *   - FTS5 syntax errors from unescaped double quotes
 *   - Boolean operator injection (AND, OR, NOT)
 *   - Prefix/wildcard injection (*, ^)
 *   - Proximity operator injection (NEAR/n)
 */

import { describe, expect, it } from "vitest";
import {
  sanitizeFTS5Term,
  buildFTS5ORPattern,
  buildFTS5QueryPattern,
} from "../../src/utils/fts5-sanitize.js";

describe("VAL-SEC-004a: Double quote escaping", () => {
  it.each([
    ['foo"bar', "foobar"],
    ['"test"', "test"],
    ['a"b"c', "abc"],
    ['"""', ""],
    ['test"', "test"],
    ['"leading', "leading"],
    ['trail"ing', "trailing"],
  ])("input %p → strips all double quotes → %p", (input, expected) => {
    expect(sanitizeFTS5Term(input)).toBe(expected);
  });

  it("should handle multiple consecutive quotes", () => {
    expect(sanitizeFTS5Term('a"""b')).toBe("ab");
    expect(sanitizeFTS5Term('"""test"""')).toBe("test");
  });
});

describe("VAL-SEC-004b: FTS5 operator removal", () => {
  describe("prefix matching operators", () => {
    it.each([
      ["foo*", "foo"],
      ["*bar", "bar"],
      ["foo*bar", "foobar"],
      ["**test**", "test"],
    ])("removes asterisk from %p → %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("initial character matching", () => {
    it.each([
      ["^test", "test"],
      ["foo^bar", "foobar"],
      ["^^test^^", "test"],
    ])("removes caret from %p → %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("boolean operators as literals", () => {
    it.each([
      ["foo AND bar", "foo AND bar"],
      ["foo OR bar", "foo OR bar"],
      ["foo NOT bar", "foo NOT bar"],
      ["AND", "AND"],
      ["OR", "OR"],
      ["NOT", "NOT"],
    ])("preserves boolean words as literals: %p → %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("proximity operator", () => {
    it.each([
      ["foo NEAR/5 bar", "foo NEAR5 bar"],
      ["NEAR/10", "NEAR10"],
      ["a/b", "ab"],
    ])("removes slash from %p → %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });

  describe("grouping operators", () => {
    it.each([
      ["(test)", "test"],
      ["foo(bar)", "foobar"],
      ["(a OR b)", "a OR b"],
    ])("removes parentheses from %p → %p", (input, expected) => {
      expect(sanitizeFTS5Term(input)).toBe(expected);
    });
  });
});

describe("VAL-SEC-004c: OR pattern construction safety", () => {
  it.each([
    [["foobar"], '"foobar"'],
    [["foo", "bar"], '"foo" OR "bar"'],
    [['foo"bar'], '"foobar"'],
    [['test"'], '"test"'],
    [['a"b', 'c"d'], '"ab" OR "cd"'],
  ])("words %p → pattern %p", (words, expected) => {
    expect(buildFTS5ORPattern(words)).toBe(expected);
  });

  it("should filter out single-character terms", () => {
    expect(buildFTS5ORPattern(["a", "foo", "b", "bar", "c"])).toBe(
      '"foo" OR "bar"'
    );
  });

  it("should return empty string for empty input", () => {
    expect(buildFTS5ORPattern([])).toBe("");
  });

  it("should return empty string when all terms too short", () => {
    expect(buildFTS5ORPattern(["a", "b", "c"])).toBe("");
  });
});

describe("VAL-SEC-004d: Consistent sanitization", () => {
  it.each([
    ["test*data"],
    ["foo^bar"],
    ['a"b'],
    ["AND"],
    ["NEAR/5"],
    ["(grouped)"],
    ["foo AND bar OR baz NOT qux"],
    ['mix"ed*cha^rs/and\\slashes'],
  ])("sanitizes %p consistently", (input) => {
    const result = sanitizeFTS5Term(input);
    // Result should be clean - no special chars remaining
    expect(result).not.toMatch(/[^a-zA-Z0-9_\s]/);
    // Result should be consistent (same input produces same output)
    expect(sanitizeFTS5Term(input)).toBe(result);
  });
});

describe("buildFTS5QueryPattern", () => {
  it("should split query and build OR pattern", () => {
    expect(buildFTS5QueryPattern("foo bar baz")).toBe(
      '"foo" OR "bar" OR "baz"'
    );
  });

  it("should handle special characters in query", () => {
    expect(buildFTS5QueryPattern('foo* "bar" ^test')).toBe(
      '"foo" OR "bar" OR "test"'
    );
  });

  it("should filter out short tokens", () => {
    expect(buildFTS5QueryPattern("a foo b bar c")).toBe('"foo" OR "bar"');
  });

  it("should handle empty query", () => {
    expect(buildFTS5QueryPattern("")).toBe("");
  });

  it("should handle query that sanitizes to empty", () => {
    expect(buildFTS5QueryPattern("* ^ \" ( )")).toBe("");
  });

  it("should normalize whitespace", () => {
    expect(buildFTS5QueryPattern("foo   bar\t\tbaz")).toBe(
      '"foo" OR "bar" OR "baz"'
    );
  });
});

describe("Edge cases", () => {
  it("should handle empty string", () => {
    expect(sanitizeFTS5Term("")).toBe("");
  });

  it("should handle only special characters", () => {
    expect(sanitizeFTS5Term('* ^ " / ( ) < >')).toBe("");
  });

  it("should preserve underscore (word char)", () => {
    expect(sanitizeFTS5Term("foo_bar")).toBe("foo_bar");
    expect(sanitizeFTS5Term("__test__")).toBe("__test__");
  });

  it("should preserve case", () => {
    expect(sanitizeFTS5Term("FooBar")).toBe("FooBar");
    expect(sanitizeFTS5Term("TEST")).toBe("TEST");
  });

  it("should trim leading/trailing whitespace", () => {
    expect(sanitizeFTS5Term("  foo  ")).toBe("foo");
    expect(sanitizeFTS5Term("\t\tbar\n\n")).toBe("bar");
  });

  it("should normalize multiple whitespace", () => {
    expect(sanitizeFTS5Term("foo    bar")).toBe("foo bar");
    expect(sanitizeFTS5Term("foo\t\t\tbar")).toBe("foo bar");
  });
});
