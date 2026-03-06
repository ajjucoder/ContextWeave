import type { EvalCodebaseFixture } from "./types.js";

export const SMALL_PROJECT_FIXTURE: EvalCodebaseFixture = {
  id: "small-project",
  label: "Small Project Fixture",
  root: "bench/scenarios/small-project/src",
  defaultTokenBudget: 4000,
  queries: [
    {
      id: "sp-auth-service",
      query: "AuthService",
      expectedFiles: ["service.ts"],
      expectedSymbols: ["AuthService"],
    },
    {
      id: "sp-hash-password",
      query: "hashPassword",
      expectedFiles: ["utils.ts"],
      expectedSymbols: ["hashPassword"],
    },
    {
      id: "sp-validate-token",
      query: "validate token",
      expectedFiles: ["service.ts", "utils.ts"],
      expectedSymbols: ["validateToken", "isTokenExpired"],
    },
    {
      id: "sp-login-handler",
      query: "login handler",
      expectedFiles: ["handler.ts", "service.ts"],
      expectedSymbols: ["AuthHandler", "handleLogin"],
    },
    {
      id: "sp-token-expiry",
      query: "token expiry",
      expectedFiles: ["service.ts", "utils.ts"],
      expectedSymbols: ["isTokenExpired"],
    },
    {
      id: "sp-create-stack",
      query: "create auth stack",
      expectedFiles: ["index.ts", "handler.ts"],
      expectedSymbols: ["createAuthStack"],
    },
  ],
  tasks: [
    {
      id: "sp-task-login-stack",
      goal: "Recover the login request path with one vague attempt and one corrective query.",
      attempts: [
        {
          id: "sp-task-login-stack-a1",
          query: "session entry flow",
          expectedFiles: ["handler.ts", "service.ts"],
          expectedSymbols: ["handleLogin", "AuthService"],
        },
        {
          id: "sp-task-login-stack-a2",
          query: "login handler",
          expectedFiles: ["handler.ts", "service.ts"],
          expectedSymbols: ["handleLogin", "AuthHandler"],
        },
      ],
    },
    {
      id: "sp-task-token-validation",
      goal: "Recover token validation logic after a conceptual miss.",
      attempts: [
        {
          id: "sp-task-token-validation-a1",
          query: "credential freshness checks",
          expectedFiles: ["service.ts", "utils.ts"],
          expectedSymbols: ["validateToken", "isTokenExpired"],
        },
        {
          id: "sp-task-token-validation-a2",
          query: "validate token",
          expectedFiles: ["service.ts", "utils.ts"],
          expectedSymbols: ["validateToken"],
        },
      ],
    },
  ],
};
