import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { generateCapsule } from "../../capsule/generator.js";
import type { CapsuleMode } from "../../core/types.js";
import type { ProjectConfig } from "../../utils/config.js";

export function registerCapsuleTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  config?: ProjectConfig,
  sessionId?: string
): void {
  const defaultBudget = config?.tokenBudget ?? 4000;
  const defaultMode = config?.defaultMode ?? "feature";
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    query: z.string().describe("What you're working on or looking for"),
    token_budget: z.number().min(100).max(100000).optional().describe(`Max tokens for the capsule (default: ${defaultBudget})`),
    mode: z.enum(["debug", "refactor", "feature", "review"]).optional().describe(`Task mode affecting scoring weights (default: ${defaultMode})`),
    path: z.string().optional().describe("Restrict results to files within this directory (relative to project root)"),
    glob: z.string().optional().describe("Restrict results to files matching this glob pattern, e.g. **/*.ts"),
  };

  registerTool(
    "cw_capsule",
    "Generate token-budgeted code context for a query. Returns compressed AST-aware context capsule with multi-level compression.",
    inputSchema,
    async ({ query, token_budget, mode, path, glob }: { query: string; token_budget?: number; mode?: CapsuleMode; path?: string; glob?: string }) => {
      try {
        const result = generateCapsule(db, {
          query,
          tokenBudget: token_budget ?? defaultBudget,
          mode: (mode ?? defaultMode) as CapsuleMode,
          sessionId,
          projectRoot,
          path,
          glob,
        });

        return {
          content: [{ type: "text" as const, text: result.content }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Capsule generation failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
