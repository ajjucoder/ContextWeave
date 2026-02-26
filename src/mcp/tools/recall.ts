import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { MemorySearch } from "../../memory/search.js";

export function registerRecallTool(server: McpServer, db: Database.Database): void {
  server.tool(
    "cw_recall",
    "Retrieve relevant prior observations from cross-session memory using BM25 search.",
    {
      query: z.string().describe("What to search for in memory"),
      scope: z.string().optional().describe("Filter by scope category"),
      include_stale: z.boolean().optional().describe("Include stale observations (default: false)"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async ({ query, scope, include_stale, limit }) => {
      const search = new MemorySearch(db);
      const results = search.search(query, {
        scope,
        includeStale: include_stale,
        limit: limit ?? 10,
      });

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No observations found for "${query}"` }],
        };
      }

      const lines = [`Memory recall for "${query}" (${results.length} results):\n`];

      for (const { observation: obs } of results) {
        const staleTag = obs.stale ? " [STALE]" : "";
        const confidenceTag = obs.confidence < 1.0 ? ` (confidence: ${obs.confidence.toFixed(2)})` : "";
        lines.push(`[${obs.scope}]${staleTag}${confidenceTag} ${obs.note}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
