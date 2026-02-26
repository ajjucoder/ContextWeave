import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { indexProject, indexSingleFile } from "../../core/indexer.js";
import { updateCentralityScores } from "../../core/graph.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("reindex-tool");

export function registerReindexTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  server.tool(
    "cw_reindex",
    "Force reindex a file, directory, or the entire project. Updates the AST graph and centrality scores.",
    {
      path: z.string().optional().describe("Specific file or directory to reindex (omit for full project)"),
    },
    async ({ path }) => {
      const startTime = Date.now();

      if (path) {
        const result = indexSingleFile(db, path, projectRoot);
        updateCentralityScores(db);
        const elapsed = Date.now() - startTime;

        return {
          content: [{
            type: "text" as const,
            text: `Reindexed ${path}: ${result.symbolCount} symbols (${elapsed}ms)${result.errors.length > 0 ? `\nErrors: ${result.errors.join(", ")}` : ""}`,
          }],
        };
      }

      const result = await indexProject(db, projectRoot);
      updateCentralityScores(db);
      const elapsed = Date.now() - startTime;

      log.info(`full reindex completed in ${elapsed}ms`);

      return {
        content: [{
          type: "text" as const,
          text: `Reindexed project: ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)${result.errors.length > 0 ? `\n${result.errors.length} errors` : ""}`,
        }],
      };
    }
  );
}
