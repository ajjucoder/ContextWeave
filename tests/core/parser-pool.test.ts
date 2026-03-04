import { describe, it, expect } from "vitest";
import { initParser } from "../../src/core/parser.js";

describe("parser pooling", () => {
  it("returns the same Parser instance for the same language", () => {
    const a = initParser("typescript");
    const b = initParser("typescript");
    expect(a).toBe(b);
  });

  it("returns different instances for different languages", () => {
    const ts = initParser("typescript");
    const js = initParser("javascript");
    expect(ts).not.toBe(js);
  });

  it("caches python parser independently", () => {
    const py1 = initParser("python");
    const py2 = initParser("python");
    expect(py1).toBe(py2);
  });
});
