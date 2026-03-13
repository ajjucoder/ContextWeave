import { describe, expect, it } from "vitest";
import { isTestFile, isRenderOnlyFile } from "../../src/capsule/generator-helpers.js";

describe("isTestFile", () => {
  it("detects dedicated test directories in addition to dotted test filenames", () => {
    expect(isTestFile("test/middleware.basic.js")).toBe(true);
    expect(isTestFile("tests/router/request-lifecycle.js")).toBe(true);
    expect(isTestFile("src/router/request-lifecycle.test.js")).toBe(true);
    expect(isTestFile("lib/application.js")).toBe(false);
  });
});

describe("isRenderOnlyFile", () => {
  it("returns true for files with only arrow and variable symbols", () => {
    const symbols = [
      { kind: "arrow" as const },
      { kind: "variable" as const },
      { kind: "arrow" as const },
    ];
    expect(isRenderOnlyFile(symbols)).toBe(true);
  });

  it("returns false when file contains a function", () => {
    const symbols = [
      { kind: "arrow" as const },
      { kind: "function" as const },
    ];
    expect(isRenderOnlyFile(symbols)).toBe(false);
  });

  it("returns false when file contains a class", () => {
    const symbols = [{ kind: "class" as const }];
    expect(isRenderOnlyFile(symbols)).toBe(false);
  });

  it("returns false when file contains a method", () => {
    const symbols = [
      { kind: "variable" as const },
      { kind: "method" as const },
    ];
    expect(isRenderOnlyFile(symbols)).toBe(false);
  });

  it("returns false for empty symbol list", () => {
    expect(isRenderOnlyFile([])).toBe(false);
  });

  it("returns true for files with only type and interface symbols (no function-like)", () => {
    const symbols = [
      { kind: "type" as const },
      { kind: "interface" as const },
    ];
    expect(isRenderOnlyFile(symbols)).toBe(true);
  });
});
