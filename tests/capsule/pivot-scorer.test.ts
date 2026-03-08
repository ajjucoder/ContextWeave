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

  it("gives exact symbol-name matches a dominant boost over partial matches", () => {
    const exactScore = scorePivotRelevance(
      {
        name: "useDataLayer",
        signature: "function useDataLayer(): DataLayer",
        kind: "function",
        filePath: "src/lib/data-layer.ts",
      },
      ["usedatalayer"]
    );
    const partialScore = scorePivotRelevance(
      {
        name: "useDataLayerCache",
        signature: "function useDataLayerCache(): Cache",
        kind: "function",
        filePath: "src/lib/data-layer-cache.ts",
      },
      ["usedatalayer"]
    );

    expect(exactScore).toBeGreaterThan(partialScore + 40);
  });

  it("gives camelCase-equivalent phrase matches an explicit secondary boost", () => {
    const camelCaseScore = scorePivotRelevance(
      {
        name: "useDataLayer",
        signature: "function useDataLayer(): DataLayer",
        kind: "function",
        filePath: "src/lib/data-layer.ts",
      },
      ["data", "layer"]
    );
    const weakerScore = scorePivotRelevance(
      {
        name: "useDashboardStore",
        signature: "function useDashboardStore(): Store",
        kind: "function",
        filePath: "src/lib/dashboard-store.ts",
      },
      ["data", "layer"]
    );

    expect(camelCaseScore).toBeGreaterThan(weakerScore + 20);
  });

  it("gives path-segment matches an explicit secondary boost for generic symbol names", () => {
    const pathMatchedScore = scorePivotRelevance(
      {
        name: "handler",
        signature: "function handler(): void",
        kind: "function",
        filePath: "src/hooks/use-data-layer/handler.ts",
      },
      ["data", "layer"]
    );
    const unrelatedPathScore = scorePivotRelevance(
      {
        name: "handler",
        signature: "function handler(): void",
        kind: "function",
        filePath: "src/utils/handler.ts",
      },
      ["data", "layer"]
    );

    expect(pathMatchedScore).toBeGreaterThan(unrelatedPathScore + 8);
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

  it("penalizes CI workflow config files for runtime middleware lifecycle queries", () => {
    const runtimeScore = scorePivotRelevance(
      {
        name: "routerHandle",
        signature: "function routerHandle(req, res, next) middleware request dispatch lifecycle",
        kind: "function",
        filePath: "lib/application.js",
      },
      ["request", "lifecycle", "middleware", "dispatch"]
    );
    const workflowScore = scorePivotRelevance(
      {
        name: "workflow dispatch request pipeline",
        signature: "workflow_dispatch request lifecycle ci pipeline",
        kind: "variable",
        filePath: ".github/workflows/ci.yml",
      },
      ["request", "lifecycle", "middleware", "dispatch"]
    );

    expect(runtimeScore).toBeGreaterThan(workflowScore);
  });

  it("penalizes type declarations for runtime schema compiler flow queries", () => {
    const runtimeScore = scorePivotRelevance(
      {
        name: "buildSchemaController",
        signature: "function buildSchemaController(setValidatorCompiler, setupValidator)",
        kind: "function",
        filePath: "lib/schema-controller.js",
      },
      ["schema", "compiler", "request", "validation", "flow"]
    );
    const typeScore = scorePivotRelevance(
      {
        name: "FastifyRequest",
        signature: "interface FastifyRequest<RouteGeneric, SchemaCompiler>",
        kind: "interface",
        filePath: "types/request.d.ts",
      },
      ["schema", "compiler", "request", "validation", "flow"]
    );

    expect(runtimeScore).toBeGreaterThan(typeScore);
  });

  it("boosts hook runtime files over adjacent route files for hook lifecycle queries", () => {
    const hooksScore = scorePivotRelevance(
      {
        name: "onSendHookRunner",
        signature: "function onSendHookRunner (functions, request, reply, payload, cb)",
        kind: "function",
        filePath: "lib/hooks.js",
      },
      ["hook", "validation", "lifecycle"]
    );
    const routeScore = scorePivotRelevance(
      {
        name: "validateHandlerTimeoutOption",
        signature: "function validateHandlerTimeoutOption (handlerTimeout)",
        kind: "function",
        filePath: "lib/route.js",
      },
      ["hook", "validation", "lifecycle"]
    );

    expect(hooksScore).toBeGreaterThan(routeScore);
  });

  it("penalizes hook type declarations for runtime hook lifecycle queries", () => {
    const hooksScore = scorePivotRelevance(
      {
        name: "onSendHookRunner",
        signature: "function onSendHookRunner (functions, request, reply, payload, cb)",
        kind: "function",
        filePath: "lib/hooks.js",
      },
      ["fastify", "hook", "validation", "lifecycle"]
    );
    const typeScore = scorePivotRelevance(
      {
        name: "onSendHookHandler",
        signature: "interface onSendHookHandler<Request, Reply>",
        kind: "interface",
        filePath: "types/hooks.d.ts",
      },
      ["fastify", "hook", "validation", "lifecycle"]
    );

    expect(hooksScore).toBeGreaterThan(typeScore);
  });

  it("normalizes absolute workspace paths before ranking runtime hook pivots", () => {
    const hooksScore = scorePivotRelevance(
      {
        name: "onSendHookRunner",
        signature: "function onSendHookRunner (functions, request, reply, payload, cb)",
        kind: "function",
        filePath: "/Users/tester/workspaces/contextweave/.qa-temp/fastify/lib/hooks.js",
      },
      ["fastify", "hook", "validation", "lifecycle"]
    );
    const typeScore = scorePivotRelevance(
      {
        name: "onSendHookHandler",
        signature: "interface onSendHookHandler<Request, Reply, Context>",
        kind: "interface",
        filePath: "/Users/tester/workspaces/contextweave/.qa-temp/fastify/types/hooks.d.ts",
      },
      ["fastify", "hook", "validation", "lifecycle"]
    );

    expect(hooksScore).toBeGreaterThan(typeScore);
  });
});
