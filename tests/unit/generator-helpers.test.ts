import { describe, expect, it } from "vitest";
import { isTestFile } from "../../src/capsule/generator-helpers.js";

describe("isTestFile", () => {
  it("detects dedicated test directories in addition to dotted test filenames", () => {
    expect(isTestFile("test/middleware.basic.js")).toBe(true);
    expect(isTestFile("tests/router/request-lifecycle.js")).toBe(true);
    expect(isTestFile("src/router/request-lifecycle.test.js")).toBe(true);
    expect(isTestFile("lib/application.js")).toBe(false);
  });
});
