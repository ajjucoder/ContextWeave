import { describe, it, expect } from "vitest";
import { decomposeForTask } from "../../src/capsule/query-decomposer.js";
import { classifyQueryIntent } from "../../src/capsule/intent-classifier.js";

function subQueryTerms(query: string): string[] {
  const classified = classifyQueryIntent(query);
  const subQueries = decomposeForTask(query, classified);
  return subQueries.flatMap((sq) => sq.terms);
}

describe("domain-adaptive task decomposition", () => {
  it("fix the pipeline bug → sub-queries contain error (fix verb bundle, no domain implied)", () => {
    const terms = subQueryTerms("fix the pipeline bug");
    expect(terms).toContain("error");
  });

  it("find all API endpoints → sub-queries contain api domain terms", () => {
    const terms = subQueryTerms("find all API endpoints");
    const apiTerms = ["route", "handler", "controller", "endpoint", "middleware", "request", "response", "schema", "validation"];
    const hasApiTerm = apiTerms.some((t) => terms.includes(t));
    expect(hasApiTerm).toBe(true);
  });

  it("implement authentication flow → sub-queries contain auth domain terms", () => {
    const terms = subQueryTerms("implement authentication flow");
    const authTerms = ["login", "session", "token", "password", "credential", "hash", "middleware", "guard", "permission"];
    const hasAuthTerm = authTerms.some((t) => terms.includes(t));
    expect(hasAuthTerm).toBe(true);
  });

  it("optimize database queries → sub-queries contain db domain terms", () => {
    const terms = subQueryTerms("optimize database queries");
    const dbTerms = ["query", "schema", "migration", "model", "table", "index", "connection", "pool", "transaction"];
    const hasDbTerm = dbTerms.some((t) => terms.includes(t));
    expect(hasDbTerm).toBe(true);
  });

  it("optimize the BFS traversal for large graphs → sub-queries contain graph domain terms", () => {
    const terms = subQueryTerms("optimize the BFS traversal for large graphs");
    const graphTerms = ["bfs", "traversal", "graph", "weightedbfstraversal", "distance", "hops", "queue", "neighbors", "visited"];
    const hasGraphTerm = graphTerms.some((t) => terms.includes(t));
    expect(hasGraphTerm).toBe(true);
  });

  it("remove the deprecated logger → sub-queries contain remove verb terms", () => {
    const terms = subQueryTerms("remove the deprecated logger");
    const removeTerms = ["usages", "references", "imports", "cleanup", "orphaned", "unused"];
    const hasRemoveTerm = removeTerms.some((t) => terms.includes(t));
    expect(hasRemoveTerm).toBe(true);
  });

  it("refactor the foobar module → falls back to verb bundles", () => {
    const terms = subQueryTerms("refactor the foobar module");
    const refactorTerms = ["interfaces", "types", "contracts", "modules", "boundaries", "dependencies", "tests", "coverage", "safety"];
    const hasRefactorTerm = refactorTerms.some((t) => terms.includes(t));
    expect(hasRefactorTerm).toBe(true);
  });
});
