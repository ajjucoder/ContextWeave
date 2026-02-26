import { describe, expect, it } from "vitest";
import { runPageRankInBackground } from "../../src/core/graph.js";

describe("runPageRankInBackground", () => {
  it("exports the background worker launcher", () => {
    expect(typeof runPageRankInBackground).toBe("function");
  });
});
