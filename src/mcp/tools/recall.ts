import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { MemorySearch } from "../../memory/search.js";
import { getRegisterTool } from "./register-helper.js";

export function registerRecallTool(server: McpServer, db: Database.Database): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_recall",
    "Retrieve relevant prior observations from cross-session memory using BM25 search.",
    {
      query: z.string().min(1).max(2000).describe("What to search for in memory"),
      scope: z.string().optional().describe("Filter by scope category"),
      include_stale: z.boolean().optional().describe("Include stale observations (default: false)"),
      limit: z.number().min(1).max(500).optional().describe("Max results (default: 10)"),
    },
    async ({ query, scope, include_stale, limit }: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => {
      try {
        const search = new MemorySearch(db);
        search.ensureBm25Consistent();
        const results = search.search(query, {
          scope,
          includeStale: include_stale,
          includePassive: true,
          limit: limit ?? 10,
        });

        if (results.length === 0) {
          const hasAny = search.hasObservations();
          const emptyMsg = hasAny
            ? `No observations found for "${query}"`
            : "No observations stored yet. Use cw_remember to store cross-session notes.";
          return {
            content: [{ type: "text" as const, text: emptyMsg }],
          };
        }

        const intentional = results.filter(({ observation }) => observation.scope !== "passive");
        const passive = results.filter(({ observation }) => observation.scope === "passive");
        const lines = [`Memory recall for "${query}" (${results.length} results):\n`];

        const renderGroup = (
          title: string,
          grouped: Array<{ observation: { scope: string; stale: boolean; confidence: number; note: string } }>
        ) => {
          if (grouped.length === 0) return;
          lines.push(`${title}:`);
          for (const { observation: obs } of grouped) {
            const staleTag = obs.stale ? " [STALE]" : "";
            const confidenceTag = obs.confidence < 1.0 ? ` (confidence: ${obs.confidence.toFixed(2)})` : "";
            lines.push(`- [${obs.scope}]${staleTag}${confidenceTag} ${obs.note}`);
          }
          lines.push("");
        };

        renderGroup("Intentional observations", intentional);
        renderGroup("Passive observations", passive);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Recall failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
