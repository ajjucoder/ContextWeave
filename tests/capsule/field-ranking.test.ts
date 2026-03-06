import { afterAll, beforeAll, describe, it } from "vitest";
import { expect } from "vitest";
import {
  expectTextExcludes,
  expectTextIncludes,
  openFieldProject,
  type FieldProject,
} from "../field/harness.js";

let sitecraft: FieldProject;
let claudometer: FieldProject;
let gravityProxy: FieldProject;

beforeAll(async () => {
  sitecraft = await openFieldProject("sitecraft");
  claudometer = await openFieldProject("claudometer");
  gravityProxy = await openFieldProject("gravity-proxy");
}, 60000);

afterAll(() => {
  sitecraft.close();
  claudometer.close();
  gravityProxy.close();
});

describe("field-style capsule ranking", () => {
  it("keeps Sitecraft inquiry flow focused on the route and server chain", () => {
    const result = sitecraft.capsule("inquiry submission email flow", 1200);

    expectTextIncludes(result.content, [
      "app/api/inquiries/route.ts",
      "submitInquiry",
      "createInquiry",
      "sendInquiryNotifications",
    ]);
    expectTextExcludes(result.content, ["InquiryHeroCard", "InquiryFaq"]);
  });

  it("keeps Claud-ometer session loading focused on loader and route symbols", () => {
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
  });

  it("keeps gravity proxy capsules on route/controller/service code instead of UI success views", () => {
    const result = gravityProxy.capsule("oauth auth flow", 1200);

    expectTextIncludes(result.content, [
      "registerOAuthRoutes",
      "exchangeCode",
      "persistProviderToken",
    ]);
    expectTextExcludes(result.content, ["OAuthSuccessView"]);
  });

  it("semantic reranking lifts conceptual flow queries without reintroducing UI noise", () => {
    const withoutRerank = sitecraft.capsule("lead capture lifecycle", 1200);
    const withRerank = sitecraft.capsule("lead capture lifecycle", 1200, { semanticRerank: true });

    const expected = ["app/api/inquiries/route.ts", "submitInquiry", "createInquiry"];
    const withoutCount = expected.filter((fragment) => withoutRerank.content.includes(fragment)).length;
    const withCount = expected.filter((fragment) => withRerank.content.includes(fragment)).length;

    expect(withCount).toBeGreaterThanOrEqual(withoutCount);
    expectTextExcludes(withRerank.content, ["InquiryHeroCard", "InquiryFaq"]);
    expect(withRerank.metadata.strategy?.semanticRerank?.enabled).toBe(true);
  });
});
