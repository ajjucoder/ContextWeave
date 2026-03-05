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
};
