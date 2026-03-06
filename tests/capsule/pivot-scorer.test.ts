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
    expect(multi).toBeGreaterThan(single * 1.5);
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

  it("boosts framework route handlers above inquiry-themed UI components", () => {
    const routeScore = scorePivotRelevance(
      {
        name: "POST",
        signature: "async function POST()",
        kind: "function",
        filePath: "app/api/inquiries/route.ts",
      },
      ["inquiry", "submission", "email", "flow"]
    );
    const componentScore = scorePivotRelevance(
      {
        name: "InquiryHeroCard",
        signature: "function InquiryHeroCard()",
        kind: "function",
        filePath: "components/InquiryHeroCard.tsx",
      },
      ["inquiry", "submission", "email", "flow"]
    );

    expect(routeScore).toBeGreaterThan(componentScore);
  });

  it("penalizes oauth success views relative to route registration and server code", () => {
    const routeScore = scorePivotRelevance(
      {
        name: "registerOAuthRoutes",
        signature: "function registerOAuthRoutes(app)",
        kind: "function",
        filePath: "src/routes/oauth.js",
      },
      ["oauth", "auth", "flow"]
    );
    const viewScore = scorePivotRelevance(
      {
        name: "OAuthSuccessView",
        signature: "function OAuthSuccessView()",
        kind: "function",
        filePath: "src/views/OAuthSuccessView.js",
      },
      ["oauth", "auth", "flow"]
    );

    expect(routeScore).toBeGreaterThan(viewScore);
  });

  it("can rank business-language inquiry flow prompts through synonym-expanded terms", () => {
    const runtimeScore = scorePivotRelevance(
      {
        name: "createInquiry",
        signature: "async function createInquiry(input)",
        kind: "function",
        filePath: "app/api/inquiries/route.ts",
      },
      ["lead", "capture", "lifecycle", "inquiry", "submit", "create", "flow", "route"]
    );
    const componentScore = scorePivotRelevance(
      {
        name: "InquiryHeroCard",
        signature: "function InquiryHeroCard()",
        kind: "function",
        filePath: "components/InquiryHeroCard.tsx",
      },
      ["lead", "capture", "lifecycle", "inquiry", "submit", "create", "flow", "route"]
    );

    expect(runtimeScore).toBeGreaterThan(componentScore);
  });
});
