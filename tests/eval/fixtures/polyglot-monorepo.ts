import type { EvalCodebaseFixture } from "./types.js";

export const POLYGLOT_MONOREPO_FIXTURE: EvalCodebaseFixture = {
  id: "polyglot-monorepo",
  label: "Polyglot Monorepo Fixture",
  root: "bench/scenarios/polyglot-monorepo",
  defaultTokenBudget: 4000,
  queries: [
    {
      id: "pm-package-boundary",
      query: "order route billing package boundary flow",
      expectedFiles: ["packages/api/src/routes/orders.ts", "packages/shared/src/billing.ts"],
      expectedSymbols: ["createOrderRoute", "createInvoiceRecord"],
    },
    {
      id: "pm-policy-heavy",
      query: "data retention policy enforcement access control",
      expectedFiles: [
        "packages/shared/src/policy.ts",
        "docs/policies/data-retention.md",
        "policies/access-control.yaml",
      ],
      expectedSymbols: ["enforceRetentionPolicy"],
    },
    {
      id: "pm-backend-framework",
      query: "fastapi create order endpoint ingestion flow",
      expectedFiles: ["python/services/app.py", "python/services/ingestion.py"],
      expectedSymbols: ["create_order_endpoint", "ingest_order_payload"],
    },
    {
      id: "pm-mixed-runtime",
      query: "ingest_order_payload normalizeOrderPayload bridge",
      expectedFiles: ["python/services/ingestion.py", "packages/shared/src/normalize.ts"],
      expectedSymbols: ["ingest_order_payload", "normalizeOrderPayload"],
    },
  ],
  tasks: [
    {
      id: "pm-task-package-boundary",
      goal: "Find package-boundary runtime flow with a broad first-shot query and an exact fallback.",
      attempts: [
        {
          id: "pm-task-package-boundary-a1",
          query: "order route invoice package boundary flow",
          expectedFiles: ["packages/api/src/routes/orders.ts", "packages/shared/src/billing.ts"],
          expectedSymbols: ["createOrderRoute", "createInvoiceRecord"],
        },
        {
          id: "pm-task-package-boundary-a2",
          query: "createOrderRoute createInvoiceRecord",
          expectedFiles: ["packages/api/src/routes/orders.ts", "packages/shared/src/billing.ts"],
          expectedSymbols: ["createOrderRoute", "createInvoiceRecord"],
        },
      ],
    },
    {
      id: "pm-task-policy-runtime",
      goal: "Find policy/runtime enforcement with a policy-heavy first pass and a symbol fallback.",
      attempts: [
        {
          id: "pm-task-policy-runtime-a1",
          query: "retention policy enforcement access control runtime",
          expectedFiles: [
            "packages/shared/src/policy.ts",
            "docs/policies/data-retention.md",
            "policies/access-control.yaml",
          ],
          expectedSymbols: ["enforceRetentionPolicy"],
        },
        {
          id: "pm-task-policy-runtime-a2",
          query: "enforceRetentionPolicy data retention policy",
          expectedFiles: [
            "packages/shared/src/policy.ts",
            "docs/policies/data-retention.md",
            "policies/access-control.yaml",
          ],
          expectedSymbols: ["enforceRetentionPolicy"],
        },
      ],
    },
    {
      id: "pm-task-mixed-backend",
      goal: "Find mixed JS/Python backend flow with a framework-oriented first pass and an exact fallback.",
      attempts: [
        {
          id: "pm-task-mixed-backend-a1",
          query: "fastapi create_order_endpoint ingest_order_payload normalizeOrderPayload",
          expectedFiles: [
            "python/services/app.py",
            "python/services/ingestion.py",
            "packages/shared/src/normalize.ts",
          ],
          expectedSymbols: ["create_order_endpoint", "ingest_order_payload", "normalizeOrderPayload"],
        },
        {
          id: "pm-task-mixed-backend-a2",
          query: "create_order_endpoint ingest_order_payload normalizeOrderPayload",
          expectedFiles: [
            "python/services/app.py",
            "python/services/ingestion.py",
            "packages/shared/src/normalize.ts",
          ],
          expectedSymbols: ["create_order_endpoint", "ingest_order_payload", "normalizeOrderPayload"],
        },
      ],
    },
  ],
};
