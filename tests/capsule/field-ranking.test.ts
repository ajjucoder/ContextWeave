import { describe, expect, it } from "vitest";
import {
  expectTextExcludes,
  expectTextIncludes,
  openFieldProject,
} from "../field/harness.js";

describe("field-style capsule ranking", () => {
  it("keeps Sitecraft inquiry flow focused on the route and server chain", async () => {
    const sitecraft = await openFieldProject("sitecraft");
    const result = sitecraft.capsule("inquiry submission email flow", 1200);

    expectTextIncludes(result.content, [
      "app/api/inquiries/route.ts",
      "submitInquiry",
      "createInquiry",
      "sendInquiryNotifications",
    ]);
    expectTextExcludes(result.content, ["InquiryHeroCard", "InquiryFaq"]);
    sitecraft.close();
  });

  it("keeps Claud-ometer session loading focused on loader and route symbols", async () => {
    const claudometer = await openFieldProject("claudometer");
    const result = claudometer.capsule("session detail loading flow", 1200);

    expectTextIncludes(result.content, [
      "loadSessionDetail",
      "app/api/sessions/[sessionId]/route.ts",
      "getSessionDetail",
    ]);
    expectTextExcludes(result.content, [
      "SessionTabs",
      "SessionTimeline",
      "SessionHeader",
    ]);
    claudometer.close();
  });

  it("keeps gravity proxy capsules on route/controller/service code instead of UI success views", async () => {
    const gravityProxy = await openFieldProject("gravity-proxy");
    const result = gravityProxy.capsule("oauth auth flow", 1200);

    expectTextIncludes(result.content, [
      "registerOAuthRoutes",
      "exchangeCode",
      "persistProviderToken",
    ]);
    expectTextExcludes(result.content, ["OAuthSuccessView"]);
    gravityProxy.close();
  });

  it("semantic reranking lifts conceptual flow queries without reintroducing UI noise", async () => {
    const sitecraftWithoutRerank = await openFieldProject("sitecraft");
    const sitecraftWithRerank = await openFieldProject("sitecraft");
    const withoutRerank = sitecraftWithoutRerank.capsule("lead capture lifecycle", 1200);
    const withRerank = sitecraftWithRerank.capsule("lead capture lifecycle", 1200, { semanticRerank: true });

    const expected = ["app/api/inquiries/route.ts", "submitInquiry", "createInquiry"];
    const withoutCount = expected.filter((fragment) => withoutRerank.content.includes(fragment)).length;
    const withCount = expected.filter((fragment) => withRerank.content.includes(fragment)).length;

    expect(withCount).toBeGreaterThanOrEqual(withoutCount);
    expectTextExcludes(withRerank.content, ["InquiryHeroCard", "InquiryFaq"]);
    expect(withRerank.metadata.strategy?.semanticRerank?.enabled).toBe(true);
    sitecraftWithoutRerank.close();
    sitecraftWithRerank.close();
  });

  it("handles business-language lead capture prompts on the first pass", async () => {
    const sitecraft = await openFieldProject("sitecraft");
    const result = sitecraft.capsule("lead capture lifecycle", 1200);

    expectTextIncludes(result.content, [
      "app/api/inquiries/route.ts",
      "submitInquiry",
      "createInquiry",
    ]);
    expectTextExcludes(result.content, ["InquiryHeroCard", "InquiryFaq"]);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.6);
    expect(result.metadata.quality.reasons).not.toContain("query term coverage below 60%");
    sitecraft.close();
  });
});
