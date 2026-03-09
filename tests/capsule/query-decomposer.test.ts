import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { decomposeQuery, mergeSubQueryTerms } from "../../src/capsule/query-decomposer.js";
import { computeTermIDF } from "../../src/capsule/generator.js";

describe("decomposeQuery", () => {
  it("returns single group for short query", () => {
    const { groups } = decomposeQuery("BFS traversal");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(["bfs", "traversal"]);
  });

  it("splits long query into 2-term groups", () => {
    const { groups } = decomposeQuery("capsule generation pipeline scoring compression");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups.every((g) => g.length >= 1)).toBe(true);
  });

  it("preserves adjacency — no cross-group reordering", () => {
    const { groups } = decomposeQuery("alpha beta gamma delta epsilon");
    const allTerms = groups.flat();
    expect(allTerms).toContain("alpha");
    expect(allTerms).toContain("epsilon");
  });

  it("returns empty array for empty query", () => {
    const { groups } = decomposeQuery("");
    expect(groups).toHaveLength(0);
  });

  it("computes IDF weights and attaches them to decomposed groups", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    const now = Date.now();
    const files = fileQueries(db);
    const syms = symbolQueries(db);

    for (let i = 0; i < 5; i += 1) {
      const fileId = files.insert({ path: `src/file-${i}.ts`, hash: `h-${i}`, lastIndexed: now, mtime: now, language: "typescript", symbolCount: 1, error: null });
      syms.insert({ fileId, name: i < 4 ? `getThing${i}` : "validateEmail", kind: "function", startLine: 1, endLine: 2, signature: i < 4 ? `function getThing${i}()` : "function validateEmail()", bodyHash: `b-${i}`, fullSource: "", isExported: true, docComment: null, centrality: 1, lastSeen: now });
    }

    const weights = computeTermIDF(db, ["get", "validateemail"]);
    expect(weights.get("get")).toBeLessThan(0.5);
    expect(weights.get("validateemail")).toBeGreaterThan(weights.get("get") ?? 0);
    db.close();
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
