import { describe, it, expect } from "vitest";
import { classifyQueryIntent } from "../../src/capsule/intent-classifier.js";
import {
  decomposeForBroad,
  decomposeForTask,
  type ClusterHint,
} from "../../src/capsule/query-decomposer.js";

describe("smart query decomposition", () => {
  it("decomposes broad queries into cluster-targeted sub-queries with normalized budget", () => {
    const classified = classifyQueryIntent("capsule generation pipeline scoring compression");
    const clusters: ClusterHint[] = [
      { id: 11, terms: ["generator", "scoring"], relevance: 5 },
      { id: 12, terms: ["packer", "compression"], relevance: 3 },
      { id: 13, terms: ["formatter", "output"], relevance: 2 },
    ];

    const subQueries = decomposeForBroad("capsule generation pipeline scoring compression", classified, clusters);

    expect(subQueries).toHaveLength(2);
    expect(subQueries[0]?.targetClusterIds).toEqual([11]);
    expect(subQueries[0]?.terms).toContain("generator");
    const totalBudget = subQueries.reduce((sum, q) => sum + q.budgetFraction, 0);
    expect(totalBudget).toBeCloseTo(1, 6);
    expect(subQueries[0]!.priority).toBe(1);
  });

  it("keeps short broad queries intact when cluster hints do not match the query terms", () => {
    const classified = classifyQueryIntent("database schema migration tables indexes");
    const clusters: ClusterHint[] = [
      { id: 13, terms: ["mcp", "tools", "capsule", "files"], relevance: 8 },
      { id: 7, terms: ["queries", "edges", "symbols"], relevance: 4 },
      { id: 6, terms: ["schema", "migrations", "connection"], relevance: 3 },
    ];

    const subQueries = decomposeForBroad("database schema migration tables indexes", classified, clusters);

    expect(subQueries).toHaveLength(1);
    expect(subQueries[0]?.targetClusterIds).toEqual([6]);
    expect(subQueries[0]?.terms).toContain("database");
    expect(subQueries[0]?.terms).toContain("schema");
    expect(subQueries[0]?.terms).toContain("migration");
    expect(subQueries[0]?.terms).toContain("indexes");
    expect(subQueries[0]?.terms).not.toContain("mcp");
    expect(subQueries[0]?.terms).not.toContain("queries");
  });

  it("decomposes task queries into focused patterns even without cluster hints", () => {
    const classified = classifyQueryIntent("find bugs in the capsule pipeline");
    const subQueries = decomposeForTask("find bugs in the capsule pipeline", classified);

    expect(subQueries.length).toBeGreaterThanOrEqual(2);
    expect(subQueries[0]!.terms).toContain("capsule");
    expect(subQueries.some((q) =>
      q.terms.includes("validation") || q.terms.includes("error") ||
      q.terms.includes("generator") || q.terms.includes("packer") || q.terms.includes("scoring")
    )).toBe(true);
    expect(subQueries[0]!.priority).toBe(1);
  });

  it("uses verb-specific decomposition for implementation tasks", () => {
    const classified = classifyQueryIntent("implement a new MCP tool for symbol search");
    const clusters: ClusterHint[] = [
      { id: 21, terms: ["tool", "registration"], relevance: 4 },
      { id: 22, terms: ["schema", "validation"], relevance: 2 },
    ];

    const subQueries = decomposeForTask("implement a new MCP tool for symbol search", classified, clusters);

    expect(subQueries.length).toBeGreaterThanOrEqual(2);
    expect(subQueries[0]!.targetClusterIds).toEqual([21]);
    expect(subQueries[0]!.terms).toContain("registration");
    expect(subQueries.some((q) => q.terms.includes("schema") || q.terms.includes("validation"))).toBe(true);
  });
});
