import { describe, it, expect } from "vitest";
import { rankPivotsWithScores, scorePivotRelevance } from "../../src/capsule/pivot-scorer.js";

describe("scorePivotRelevance", () => {
  const queryTerms = ["capsule", "generator", "pipeline"];

  it("marks exact identifier matches and ranks them above broader neighbors", () => {
    const ranked = rankPivotsWithScores(
      [
        {
          id: 1,
          name: "useDataLayer",
          signature: "function useDataLayer()",
          kind: "function",
          filePath: "src/hooks/use-data-layer.ts",
        },
        {
          id: 2,
          name: "useDataLayerRuntimeBridge",
          signature: "function useDataLayerRuntimeBridge(loadDashboardDataLayer)",
          kind: "function",
          filePath: "src/runtime/use-data-layer-bridge.ts",
        },
      ],
      ["useDataLayer"],
      10
    );

    expect(ranked.scored[0]?.id).toBe(1);
    expect(ranked.scored[0]?.exactNameMatch).toBe(true);
    expect(ranked.scored[1]?.exactNameMatch).toBe(false);
  });

  it("treats camelCase split matches as exact-name hits when all parts are present", () => {
    const ranked = rankPivotsWithScores(
      [
        {
          id: 1,
          name: "useDataLayer",
          signature: "function useDataLayer()",
          kind: "function",
          filePath: "src/hooks/use-data-layer.ts",
        },
        {
          id: 2,
          name: "layerDiagnostics",
          signature: "function layerDiagnostics()",
          kind: "function",
          filePath: "src/diagnostics/layer.ts",
        },
      ],
      ["use", "data", "layer"],
      10
    );

    expect(ranked.scored[0]?.id).toBe(1);
    expect(ranked.scored[0]?.exactNameMatch).toBe(true);
  });

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
      { name: "capsuleLogQueries", signature: "function capsuleLogQueries(db)", kind: "function", filePath: "src/db/queries/logging.ts" },
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

  it("suppresses ubiquitous code terms with IDF weights so validateEmail outranks getSomething", () => {
    const ranked = rankPivotsWithScores(
      [
        {
          id: 1,
          name: "getSomething",
          signature: "function getSomething()",
          kind: "function",
          filePath: "src/routes/get-something.ts",
        },
        {
          id: 2,
          name: "validateEmail",
          signature: "function validateEmail()",
          kind: "function",
          filePath: "src/validators/email.ts",
        },
      ],
      ["get", "validateemail"],
      10,
      new Map([
        ["get", 0.2],
        ["validateemail", 1.4],
      ])
    );

    expect(ranked.scored[0]?.id).toBe(2);
  });

  it("boosts co-located multi-term candidates for proximity-style queries", () => {
    const ranked = rankPivotsWithScores(
      [
        {
          id: 1,
          name: "AuthMiddleware",
          signature: "function AuthMiddleware(request, middlewareContext)",
          kind: "function",
          filePath: "src/auth/middleware.ts",
        },
        {
          id: 2,
          name: "AuthPipeline",
          signature:
            "function AuthPipeline(request, next) // authorization boundary with many unrelated details before middleware registration",
          kind: "function",
          filePath: "src/security/pipeline.ts",
        },
      ],
      ["auth", "middleware"],
      10
    );

    expect(ranked.scored[0]?.id).toBe(1);
    expect((ranked.scored[0]?.score ?? 0) / (ranked.scored[1]?.score ?? 1)).toBeGreaterThan(1.4);
  });

  it("does not apply the proximity boost when query terms are far apart", () => {
    const closeScore = scorePivotRelevance(
      {
        name: "AuthMiddleware",
        signature: "function AuthMiddleware(request, middlewareContext)",
        kind: "function",
        filePath: "src/auth/middleware.ts",
      },
      ["auth", "middleware"]
    );
    const distantScore = scorePivotRelevance(
      {
        name: "AuthPipeline",
        signature:
          "function AuthPipeline(request, next) // authorization boundary with many unrelated details before middleware registration",
        kind: "function",
        filePath: "src/security/pipeline.ts",
      },
      ["auth", "middleware"]
    );

    expect(closeScore).toBeGreaterThan(distantScore);
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
