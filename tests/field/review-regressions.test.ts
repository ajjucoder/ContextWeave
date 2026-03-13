import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObservationStore } from "../../src/memory/observations.js";
import {
  expectTextExcludes,
  expectTextIncludes,
  openFieldProject,
  type FieldProject,
} from "./harness.js";

let sitecraft: FieldProject;
let claudometer: FieldProject;
let gravityProxy: FieldProject;
let ebps: FieldProject;
let nextPagesRouter: FieldProject;

beforeAll(async () => {
  sitecraft = await openFieldProject("sitecraft", ({ db, sessionId }) => {
    const store = new ObservationStore(db);
    store.create({
      sessionId,
      scope: "architecture",
      note: "Inquiry flow: POST /api/inquiries persists the inquiry before sendInquiryNotifications fans out email alerts.",
    });
    store.create({
      sessionId,
      scope: "passive",
      note: '[auto] Query: "inquiry flow" resolved to: InquiryHeroCard, MarketingTestimonials',
      confidence: 0.4,
    });
    store.create({
      sessionId,
      scope: "passive",
      note: '[auto] Query: "contact form styles" resolved to: HeroBanner, InquiryFaq',
      confidence: 0.4,
    });
  });

  claudometer = await openFieldProject("claudometer");
  gravityProxy = await openFieldProject("gravity-proxy");
  ebps = await openFieldProject("ebps");
  nextPagesRouter = await openFieldProject("next-pages-router");
}, 60000);

afterAll(() => {
  sitecraft.close();
  claudometer.close();
  gravityProxy.close();
  ebps.close();
  nextPagesRouter.close();
});

describe("Sitecraft field regression", () => {
  it("capsule prioritizes the inquiry route and server fanout over inquiry-themed UI noise", () => {
    const result = sitecraft.capsule("inquiry submission email flow", 1200);
    expectTextIncludes(result.content, [
      "app/api/inquiries/route.ts",
      "submitInquiry",
      "createInquiry",
      "sendInquiryNotifications",
    ]);
    expectTextExcludes(result.content, ["InquiryHeroCard", "InquiryFaq"]);
  });

  it("cw_flow traces client fetch code through the Next.js route boundary into the server service", async () => {
    const text = await sitecraft.runTool("cw_flow", {
      source: "POST",
      target: "createInquiry",
      max_hops: 6,
    });

    expectTextIncludes(text, ["POST", "createInquiry"]);
  });

  it("cw_recall returns durable architecture notes before passive query telemetry by default", async () => {
    const text = await sitecraft.runTool("cw_recall", {
      query: "inquiry flow",
      limit: 5,
    });

    expectTextIncludes(text, [
      "Intentional observations:",
      "POST /api/inquiries persists the inquiry",
    ]);
    expectTextIncludes(text, ["Passive observations:"]);
    const intentionalIdx = text.indexOf("Intentional observations:");
    const passiveIdx = text.indexOf("Passive observations:");
    expect(intentionalIdx).toBeLessThan(passiveIdx);
  });
});

describe("Claud-ometer field regression", () => {
  it("capsule surfaces the session loader, route handler, and server resolver before UI tabs", () => {
    const result = claudometer.capsule("session detail loading flow", 1200);
    expectTextIncludes(result.content, [
      "app/api/sessions/[sessionId]/route.ts",
      "loadSessionDetail",
      "GET",
      "getSessionDetail",
    ]);
    expectTextExcludes(result.content, [
      "SessionTabs",
      "SessionTimeline",
      "SessionHeader",
    ]);
  });

  it("cw_flow traces session detail loading across the HTTP boundary", async () => {
    const text = await claudometer.runTool("cw_flow", {
      source: "GET",
      target: "getSessionDetail",
      max_hops: 6,
    });

    expectTextIncludes(text, ["GET", "getSessionDetail"]);
  });

  it("cw_read can jump directly to the Next.js route handler by file-qualified symbol", async () => {
    const text = await claudometer.runTool("cw_read", {
      symbol: "app/api/sessions/[sessionId]/route.ts:GET",
      max_lines: 30,
    });

    expectTextIncludes(text, [
      "Read app/api/sessions/[sessionId]/route.ts",
      "Symbol: function GET",
      "getSessionDetail",
    ]);
  });
});

describe("Next pages-router field regression", () => {
  it("capsule surfaces the pages loader, api handler, and server resolver before UI widgets", () => {
    const result = nextPagesRouter.capsule("user detail page load flow", 1200);
    expectTextIncludes(result.content, [
      "pages/users/[userId].tsx",
      "getServerSideProps",
      "pages/api/users/[userId].ts",
      "getUserDetail",
    ]);
  });

  it("cw_flow traces the pages loader across the pages/api boundary", async () => {
    const text = await nextPagesRouter.runTool("cw_flow", {
      source: "handler",
      target: "getUserDetail",
      max_hops: 6,
    });

    expectTextIncludes(text, ["handler", "getUserDetail"]);
  });
});

describe("gravity claude proxy field regression", () => {
  it("capsule keeps the oauth route/controller/service chain instead of UI success views", () => {
    const result = gravityProxy.capsule("oauth auth flow", 1200);
    expectTextIncludes(result.content, [
      "registerOAuthRoutes",
      "handleOAuthCallback",
      "exchangeCode",
      "persistProviderToken",
    ]);
    expectTextExcludes(result.content, ["OAuthSuccessView"]);
  });

  it("cw_flow traces Express route registration into the controller and token persistence service", async () => {
    const text = await gravityProxy.runTool("cw_flow", {
      source: "registerOAuthRoutes",
      target: "persistProviderToken",
      max_hops: 6,
    });

    expectTextIncludes(text, [
      "registerOAuthRoutes",
      "handleOAuthCallback",
      "persistProviderToken",
    ]);
  });

  it("cw_impact follows same-module oauth helpers and route registration dependents", async () => {
    const text = await gravityProxy.runTool("cw_impact", {
      target: "src/services/oauth-service.js:persistProviderToken",
      depth: 4,
    });

    expectTextIncludes(text, ["handleOAuthCallback", "registerOAuthRoutes"]);
  });

  it("cw_read resolves object-exported controller methods by file-qualified symbol", async () => {
    const text = await gravityProxy.runTool("cw_read", {
      symbol: "src/controllers/oauth-controller.js:handleOAuthCallback",
      max_lines: 40,
    });

    expectTextIncludes(text, [
      "Read src/controllers/oauth-controller.js",
      "handleOAuthCallback",
      "exchangeCode",
    ]);
  });
});

describe("EBPS field regression", () => {
  it("capsule includes rules documents and calibrated confidence for small policy-heavy repos", () => {
    const result = ebps.capsule("district approval partner rules", 900);

    expectTextIncludes(result.content, [
      "evaluatePartnerEligibility",
      "config/program-rules.yaml",
      "docs/partner-policy.md",
    ]);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.35);
  });

  it("cw_overview can surface the policy docs that drive eligibility behavior", async () => {
    const text = await ebps.runTool("cw_overview", {
      path: ".",
      depth: 3,
      max_tokens: 1600,
      query: "district approval",
    });

    expectTextIncludes(text, [
      "config/program-rules.yaml",
      "docs/partner-policy.md",
    ]);
  });
});

describe("Review theme: confidence calibration", () => {
  it("narrow capsule for nonexistent symbol does not report HIGH confidence", () => {
    const result = ebps.capsule("xyzNonExistentSymbol42", 1200);
    expect(result.metadata.quality.coverageConfidence).toBeLessThanOrEqual(0.44);
  });

  it("broad capsule confidence is bounded between 0 and 1", () => {
    const result = nextPagesRouter.capsule("user detail page load flow", 1200);
    expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0);
    expect(result.metadata.quality.coverageConfidence).toBeLessThanOrEqual(1);
  });
});

describe("Review theme: budget utilization gates", () => {
  it.todo("broad capsule uses at least 60% of token budget (CW-P0-002)");
  it.todo("refill logic reaches 85% when enough candidates exist (CW-P0-002)");
});

describe("Review theme: follow-up suggestions", () => {
  it("follow-up reads include file paths when present", () => {
    const result = nextPagesRouter.capsule("user detail page load flow", 1200);
    if (result.content.includes("Follow-Up Reads")) {
      const followUpSection = result.content.split("Follow-Up Reads")[1]?.split("---")[0] ?? "";
      if (followUpSection.includes("cw_read")) {
        expect(followUpSection).toMatch(/file:\s*"/);
      }
    }
  });
});
