import { describe, it, expect } from "vitest";
import { classifyQueryIntent } from "../../src/capsule/intent-classifier.js";

describe("classifyQueryIntent", () => {
  it("classifies narrow symbol-style lookups", () => {
    expect(classifyQueryIntent("generateCapsule").intent).toBe("symbol-lookup");
    expect(classifyQueryIntent("SessionContext").intent).toBe("symbol-lookup");
  });

  it("classifies broad architectural queries", () => {
    const classified = classifyQueryIntent("capsule generation pipeline scoring compression");
    expect(classified.intent).toBe("broad");
    expect(classified.focusTerms).toContain("generation");
  });

  it("treats short flow-oriented architecture queries as broad, not narrow symbol lookups", () => {
    const classified = classifyQueryIntent("oauth auth flow");
    expect(classified.intent).toBe("broad");
  });

  it("classifies task-oriented queries and extracts action verbs", () => {
    const classified = classifyQueryIntent("find bugs in the capsule pipeline");
    expect(classified.intent).toBe("task");
    expect(classified.actionVerbs).toEqual(["find"]);
    expect(classified.suggestedBudgetMultiplier).toBe(2);
  });

  it("maps terms to implied modules", () => {
    const classified = classifyQueryIntent("optimize auth token login session flow");
    expect(classified.impliedModules).toContain("auth");
  });

  it("maps graph traversal vocabulary to the graph module", () => {
    const classified = classifyQueryIntent("optimize the BFS traversal for large graphs");
    expect(classified.impliedModules).toContain("graph");
  });

  it("normalizes and deduplicates non-signal terms", () => {
    const classified = classifyQueryIntent("the capsule and capsule pipeline");
    expect(classified.normalizedTerms).toEqual(["capsule", "pipeline"]);
  });

  it("classifies question-word queries as exploration or broad based on concept signals", () => {
    // "how does authentication work" → broad (authentication is a concept signal)
    expect(classifyQueryIntent("how does authentication work").intent).toBe("broad");
    // "what is the session guard" → narrow (no concept signal)
    expect(classifyQueryIntent("what is the session guard").intent).toBe("narrow");
    // "why does login fail" → narrow (no concept signal, but no debug signal either)
    expect(classifyQueryIntent("why does login fail").intent).toBe("narrow");
  });

  it("classifies multi-term question queries as broad", () => {
    const classified = classifyQueryIntent("how does authentication middleware session guard dashboard work");
    expect(classified.intent).toBe("broad");
    // question words should NOT appear in normalizedTerms
    expect(classified.normalizedTerms).not.toContain("how");
    expect(classified.normalizedTerms).not.toContain("what");
    expect(classified.normalizedTerms).not.toContain("why");
  });

  it("prioritizes debug intent when a fix-style question includes bug signals", () => {
    const classified = classifyQueryIntent("how do I fix the auth bug");
    expect(classified.intent).toBe("debug");
    expect(classified.actionVerbs).toContain("fix");
  });
});
