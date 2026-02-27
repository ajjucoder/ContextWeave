import { describe, it, expect } from "vitest";
import { scorePivotRelevance } from "../../src/capsule/pivot-scorer.js";

describe("scorePivotRelevance", () => {
  const queryTerms = ["capsule", "generator", "pipeline"];

  it("scores exact name match highest", () => {
    const score = scorePivotRelevance(
      { name: "generateCapsule", signature: "function generateCapsule(db, params): CapsuleOutput", kind: "function", filePath: "src/capsule/generator.ts" },
      queryTerms
    );
    expect(score).toBeGreaterThan(5);
  });

  it("scores single-term match much lower", () => {
    const multi = scorePivotRelevance(
      { name: "generateCapsule", signature: "function generateCapsule(db, params)", kind: "function", filePath: "src/capsule/generator.ts" },
      queryTerms
    );
    const single = scorePivotRelevance(
      { name: "capsuleLogQueries", signature: "function capsuleLogQueries(db)", kind: "function", filePath: "src/db/queries/capsule-log.ts" },
      queryTerms
    );
    expect(multi).toBeGreaterThan(single * 2);
  });

  it("boosts file path matches", () => {
    const withPath = scorePivotRelevance(
      { name: "formatCapsule", signature: "function formatCapsule(...)", kind: "function", filePath: "src/capsule/formatter.ts" },
      queryTerms
    );
    const withoutPath = scorePivotRelevance(
      { name: "formatCapsule", signature: "function formatCapsule(...)", kind: "function", filePath: "src/utils/helpers.ts" },
      queryTerms
    );
    expect(withPath).toBeGreaterThan(withoutPath);
  });

  it("returns 0 for no matches", () => {
    const score = scorePivotRelevance(
      { name: "hashFile", signature: "function hashFile(content)", kind: "function", filePath: "src/utils/hash.ts" },
      queryTerms
    );
    expect(score).toBe(0);
  });
});
