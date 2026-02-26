import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { ObservationStore } from "../../memory/observations.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { sessionQueries } from "../../db/queries/sessions.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";

export function registerRememberTool(
  server: McpServer,
  db: Database.Database,
  sessionId: string,
  projectRoot: string
): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);

  registerTool(
    "cw_remember",
    "Persist a cross-session observation about the codebase. Observations survive between sessions and inform future context capsules.",
    {
      scope: z.string().max(100).describe("Category: architecture, bug, pattern, decision, todo, convention"),
      note: z.string().max(10000).describe("The observation to remember"),
      symbol: z.string().optional().describe("Symbol name to associate with (optional)"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence level 0-1 (default: 1.0)"),
    },
    async ({ scope, note, symbol, confidence }: { scope: string; note: string; symbol?: string; confidence?: number }) => {
      try {
        const store = new ObservationStore(db);
        sessionQueries(db).ensureSession(sessionId, projectRoot);

        let symbolId: number | undefined;
        if (symbol) {
          const symbols = symbolQueries(db);
          const allNames = symbols.getAllNames();
          const matches = fuzzyMatch(symbol, allNames, 0.6);
          if (matches.length > 0) {
            const syms = symbols.getByName(matches[0]!.name);
            if (syms.length > 0) {
              symbolId = syms[0]!.id;
            }
          }
        }

        const result = store.create({
          sessionId,
          scope,
          note,
          symbolId,
          confidence,
        });
        const id = result.id;

        const response = symbolId
          ? `Remembered observation #${id} [${scope}] linked to symbol`
          : `Remembered observation #${id} [${scope}]`;

        return {
          content: [{ type: "text" as const, text: response }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Remember failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
