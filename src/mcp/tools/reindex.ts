import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { resolve } from "node:path";
import { indexProject, indexSingleFile, isPathWithinRoot } from "../../core/indexer.js";
import { runPageRankInBackground } from "../../core/graph.js";
import { createLogger } from "../../utils/logger.js";
import type { ProjectConfig } from "../../utils/config.js";

const log = createLogger("reindex-tool");

export function registerReindexTool(server: McpServer, db: Database.Database, projectRoot: string, config?: ProjectConfig): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);

  registerTool(
    "cw_reindex",
    "Force reindex a file, directory, or the entire project. Updates the AST graph and centrality scores.",
    {
      path: z.string().optional().describe("Specific file or directory to reindex (omit for full project)"),
    },
    async ({ path }: { path?: string }) => {
      try {
        const startTime = Date.now();
        const dbPath = resolve(projectRoot, ".contextweave", "contextweave.db");

        if (path) {
          const fullPath = resolve(projectRoot, path);

          if (!isPathWithinRoot(fullPath, projectRoot)) {
            return {
              content: [{ type: "text" as const, text: `Error: path "${path}" is outside the project root` }],
              isError: true,
            };
          }

          const result = indexSingleFile(db, fullPath, projectRoot);
          runPageRankInBackground(dbPath);
          const elapsed = Date.now() - startTime;

          return {
            content: [{
              type: "text" as const,
              text: `Reindexed ${path}: ${result.symbolCount} symbols (${elapsed}ms)${result.errors.length > 0 ? `\nErrors: ${result.errors.join(", ")}` : ""}`,
            }],
          };
        }

        const result = await indexProject(db, projectRoot, config?.ignore);
        runPageRankInBackground(dbPath);
        const elapsed = Date.now() - startTime;

        log.info(`full reindex completed in ${elapsed}ms`);

        return {
          content: [{
            type: "text" as const,
            text: `Reindexed project: ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)${result.errors.length > 0 ? `\n${result.errors.length} errors` : ""}`,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("reindex failed", { error: message });
        return {
          content: [{ type: "text" as const, text: `Reindex failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
