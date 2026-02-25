import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { generateCapsule } from "../../capsule/generator.js";
import type { CapsuleMode } from "../../core/types.js";

export function registerCapsuleTool(server: McpServer, db: Database.Database, _projectRoot: string): void {
  server.tool(
    "cw_capsule",
    "Generate token-budgeted code context for a query. Returns compressed AST-aware context capsule with multi-level compression.",
    {
      query: z.string().describe("What you're working on or looking for"),
      token_budget: z.number().optional().describe("Max tokens for the capsule (default: 4000)"),
      mode: z.enum(["debug", "refactor", "feature", "review"]).optional().describe("Task mode affecting scoring weights (default: feature)"),
    },
    async ({ query, token_budget, mode }) => {
      const result = generateCapsule(db, {
        query,
        tokenBudget: token_budget,
        mode: mode as CapsuleMode | undefined,
      });

      return {
        content: [{ type: "text" as const, text: result.content }],
      };
    }
  );
}
