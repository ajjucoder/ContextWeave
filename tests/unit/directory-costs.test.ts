import { describe, it, expect } from "vitest";
import { getDirectoryWeight } from "../../src/utils/directory-weights.js";

describe("getDirectoryWeight", () => {
  it("heavily penalizes legacy directories", () => {
    expect(getDirectoryWeight("sitecraft_legacy/App.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("sitecraft_demo_AIStudio/App.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("old/components/Button.tsx")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("archive/v1/types.ts")).toBeLessThanOrEqual(0.2);
    expect(getDirectoryWeight("prototype/experiments.ts")).toBeLessThanOrEqual(0.2);
  });

  it("does not penalize active src directories", () => {
    expect(getDirectoryWeight("src/components/Button.tsx")).toBeGreaterThanOrEqual(0.9);
    expect(getDirectoryWeight("app/api/route.ts")).toBeGreaterThanOrEqual(0.9);
  });

  it("penalizes vendor and external directories", () => {
    expect(getDirectoryWeight("vendor/lodash/index.js")).toBeLessThan(0.5);
    expect(getDirectoryWeight("third_party/lib/utils.ts")).toBeLessThan(0.5);
  });

  it("penalizes demo and examples directories", () => {
    expect(getDirectoryWeight("examples/basic/index.ts")).toBeLessThan(0.5);
    expect(getDirectoryWeight("demo/app/main.ts")).toBeLessThan(0.5);
  });
});
