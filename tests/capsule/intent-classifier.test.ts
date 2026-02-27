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
});
