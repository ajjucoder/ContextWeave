import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { observationQueries } from "../../db/queries/observations.js";

export function registerStatusTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  server.tool(
    "cw_status",
    "Show index health: file count, symbol count, edge count, stale observations, and last index time.",
    {
      verbose: z.boolean().optional().describe("Show per-file details (default: false)"),
    },
    async ({ verbose }) => {
      const files = fileQueries(db);
      const symbols = symbolQueries(db);
      const edges = edgeQueries(db);
      const observations = observationQueries(db);

      const fileCount = files.count();
      const symbolCount = symbols.count();
      const edgeCount = edges.count();
      const observationCount = observations.count();
      const staleCount = observations.countStale();

      const lines = [
        `ContextWeave Index Status`,
        `Project: ${projectRoot}`,
        ``,
        `Files:        ${fileCount}`,
        `Symbols:      ${symbolCount}`,
        `Edges:        ${edgeCount}`,
        `Observations: ${observationCount} (${staleCount} stale)`,
      ];

      if (verbose) {
        lines.push(`\nPer-file breakdown:`);
        const allFiles = files.getAll();
        for (const file of allFiles) {
          const errTag = file.error ? ` [ERROR: ${file.error}]` : "";
          lines.push(`  ${file.path} (${file.symbolCount} symbols, ${file.language})${errTag}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
