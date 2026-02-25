import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { generateCapsule } from "../../capsule/generator.js";
import type { CapsuleMode } from "../../core/types.js";
import type { ProjectConfig } from "../../utils/config.js";

export function registerCapsuleTool(
  server: McpServer,
  db: Database.Database,
  _projectRoot: string,
  config?: ProjectConfig,
  sessionId?: string
): void {
  const defaultBudget = config?.tokenBudget ?? 4000;
  const defaultMode = config?.defaultMode ?? "feature";

  server.tool(
    "cw_capsule",
    "Generate token-budgeted code context for a query. Returns compressed AST-aware context capsule with multi-level compression.",
    {
      query: z.string().describe("What you're working on or looking for"),
      token_budget: z.number().optional().describe(`Max tokens for the capsule (default: ${defaultBudget})`),
      mode: z.enum(["debug", "refactor", "feature", "review"]).optional().describe(`Task mode affecting scoring weights (default: ${defaultMode})`),
    },
    async ({ query, token_budget, mode }) => {
      const result = generateCapsule(db, {
        query,
        tokenBudget: token_budget ?? defaultBudget,
        mode: (mode ?? defaultMode) as CapsuleMode,
        sessionId,
      });

      return {
        content: [{ type: "text" as const, text: result.content }],
      };
    }
  );
}
