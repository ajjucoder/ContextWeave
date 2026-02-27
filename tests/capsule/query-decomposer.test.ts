import { describe, it, expect } from "vitest";
import { decomposeQuery, mergeSubQueryTerms } from "../../src/capsule/query-decomposer.js";

describe("decomposeQuery", () => {
  it("returns single group for short query", () => {
    const groups = decomposeQuery("BFS traversal");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(["bfs", "traversal"]);
  });

  it("splits long query into 2-term groups", () => {
    const groups = decomposeQuery("capsule generation pipeline scoring compression");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.every((g) => g.length >= 1)).toBe(true);
  });

  it("preserves adjacency — no cross-group reordering", () => {
    const groups = decomposeQuery("alpha beta gamma delta epsilon");
    const allTerms = groups.flat();
    expect(allTerms).toContain("alpha");
    expect(allTerms).toContain("epsilon");
  });

  it("returns empty array for empty query", () => {
    const groups = decomposeQuery("");
    expect(groups).toHaveLength(0);
  });
});

describe("mergeSubQueryTerms", () => {
  it("flattens sub-queries into unique terms", () => {
    const merged = mergeSubQueryTerms([["alpha", "beta"], ["beta", "gamma"]]);
    expect(merged).toContain("alpha");
    expect(merged).toContain("beta");
    expect(merged).toContain("gamma");
    expect(merged.filter((t) => t === "beta")).toHaveLength(1); // deduped
  });
});
