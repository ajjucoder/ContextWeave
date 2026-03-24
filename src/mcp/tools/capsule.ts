import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { resolve } from "node:path";
import { generateCapsuleWithRuntime } from "../../capsule/generator.js";
import type { CapsuleMode, EmbeddingRuntime } from "../../core/types.js";
import type { ProjectConfig } from "../../utils/config.js";
import { getRegisterTool } from "./register-helper.js";
import { isPathWithinRoot } from "../../core/indexer.js";

// Security: Path traversal prevention helper
const containsTraversal = (value: string): boolean => {
  // Check for .. path segments that could escape project root
  // Matches: ../, ..\, /../, \..\, .. at end, etc.
  const traversalPattern = /(\.\.\/|\.\.\\|^\.\.$|\.\.$)/;
  return traversalPattern.test(value);
};

// Security: Check if path is absolute (Unix absolute or Windows absolute/UNC)
const isAbsolutePath = (value: string): boolean => {
  // Unix absolute path
  if (value.startsWith("/")) return true;
  // Windows absolute path (C:\, D:\, etc.)
  if (/^[a-zA-Z]:[/\\]/.test(value)) return true;
  // Windows UNC path (\\server\share)
  if (value.startsWith("\\\\")) return true;
  return false;
};

// Security-hardened path schema: no traversal, max 4096 chars
const pathSchema = z.string()
  .max(4096, "Path exceeds maximum length of 4096 characters")
  .refine(
    (val) => !containsTraversal(val),
    { message: "Path traversal not allowed: path contains '..' segments" }
  )
  .optional();

// Security-hardened glob schema: no traversal, max 4096 chars  
const globSchema = z.string()
  .max(4096, "Glob pattern exceeds maximum length of 4096 characters")
  .refine(
    (val) => !containsTraversal(val),
    { message: "Path traversal not allowed: glob contains '..' segments" }
  )
  .optional();

export function registerCapsuleTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  config?: ProjectConfig,
  sessionId?: string,
  embeddingRuntime?: EmbeddingRuntime | null
): void {
  const defaultBudget = config?.tokenBudget ?? 4000;
  const defaultMode = config?.defaultMode ?? "feature";
  const registerTool = getRegisterTool(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    query: z.string().min(1).max(2000).describe("What you're working on or looking for"),
    token_budget: z.number().min(100).max(100000).optional().describe(`Max tokens for the capsule (default: ${defaultBudget})`),
    mode: z.enum(["debug", "refactor", "feature", "review"]).optional().describe(`Task mode affecting scoring weights (default: ${defaultMode})`),
    path: pathSchema.describe("Restrict results to files within this directory (relative to project root)"),
    glob: globSchema.describe("Restrict results to files matching this glob pattern, e.g. **/*.ts"),
    anchor_symbols: z.array(z.string().min(1).max(512)).max(20).optional().describe("Optional symbol anchors to seed retrieval from related subgraphs"),
  };

  registerTool(
    "cw_capsule",
    "Generate token-budgeted code context for a query. Returns compressed AST-aware context capsule with multi-level compression.",
    inputSchema,
    async ({ query, token_budget, mode, path, glob, anchor_symbols }: { query: string; token_budget?: number; mode?: CapsuleMode; path?: string; glob?: string; anchor_symbols?: string[] }) => {
      // Runtime security validation: Zod .refine() and .max() errors are not preserved by MCP SDK schema conversion
      // So we validate path/glob traversal AND length here at runtime
      if (path !== undefined) {
        if (path.length > 4096) {
          return {
            content: [{ type: "text" as const, text: "Path exceeds maximum length of 4096 characters" }],
            isError: true,
          };
        }
        if (containsTraversal(path)) {
          return {
            content: [{ type: "text" as const, text: "Path traversal not allowed: path contains '..' segments" }],
            isError: true,
          };
        }
        // Reject absolute paths (they could escape project root)
        if (isAbsolutePath(path)) {
          return {
            content: [{ type: "text" as const, text: `Error: absolute path rejected: "${path}"` }],
            isError: true,
          };
        }
        const fullPath = resolve(projectRoot, path);
        if (!isPathWithinRoot(fullPath, projectRoot)) {
          return {
            content: [{ type: "text" as const, text: `Error: path "${path}" is outside the project root` }],
            isError: true,
          };
        }
      }
      if (glob !== undefined) {
        if (glob.length > 4096) {
          return {
            content: [{ type: "text" as const, text: "Glob pattern exceeds maximum length of 4096 characters" }],
            isError: true,
          };
        }
        if (containsTraversal(glob)) {
          return {
            content: [{ type: "text" as const, text: "Path traversal not allowed: glob contains '..' segments" }],
            isError: true,
          };
        }
      }

      try {
        const result = await generateCapsuleWithRuntime(db, {
          query,
          tokenBudget: token_budget ?? defaultBudget,
          mode: (mode ?? defaultMode) as CapsuleMode,
          sessionId,
          projectRoot,
          path,
          glob,
          anchorSymbols: anchor_symbols,
        }, embeddingRuntime);

        const contentParts: Array<{ type: "text"; text: string }> = [
          { type: "text" as const, text: result.content },
        ];
        if (result.structured) {
          contentParts.push({
            type: "text" as const,
            text: `\n<!-- structured_output: ${JSON.stringify(result.structured)} -->`,
          });
        }
        return { content: contentParts };
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
