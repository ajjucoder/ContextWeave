import { describe, it, expect } from "vitest";
import { classifyQueryIntent } from "../../src/capsule/intent-classifier.js";

describe("classifyQueryIntent", () => {
  it("classifies narrow symbol-style lookups", () => {
    expect(classifyQueryIntent("generateCapsule").intent).toBe("narrow");
    expect(classifyQueryIntent("SessionContext").intent).toBe("narrow");
  });

  it("classifies broad architectural queries", () => {
    const classified = classifyQueryIntent("capsule generation pipeline scoring compression");
    expect(classified.intent).toBe("broad");
    expect(classified.focusTerms).toContain("generation");
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

  it("normalizes and deduplicates non-signal terms", () => {
    const classified = classifyQueryIntent("the capsule and capsule pipeline");
    expect(classified.normalizedTerms).toEqual(["capsule", "pipeline"]);
  });

  it("classifies question-word queries as exploration, not task", () => {
    // "how does X work" → narrow (single focus term)
    expect(classifyQueryIntent("how does authentication work").intent).toBe("narrow");
    // "what is" → narrow
    expect(classifyQueryIntent("what is the session guard").intent).toBe("narrow");
    // "why does" → narrow
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

  it("keeps real action verbs as task even when question words are present", () => {
    const classified = classifyQueryIntent("how do I fix the auth bug");
    // "fix" is an action verb → task
    expect(classified.intent).toBe("task");
    expect(classified.actionVerbs).toContain("fix");
  });
});
