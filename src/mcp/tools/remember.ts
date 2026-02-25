import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { ObservationStore } from "../../memory/observations.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";

export function registerRememberTool(server: McpServer, db: Database.Database): void {
  server.tool(
    "cw_remember",
    "Persist a cross-session observation about the codebase. Observations survive between sessions and inform future context capsules.",
    {
      scope: z.string().describe("Category: architecture, bug, pattern, decision, todo, convention"),
      note: z.string().describe("The observation to remember"),
      symbol: z.string().optional().describe("Symbol name to associate with (optional)"),
      confidence: z.number().min(0).max(1).optional().describe("Confidence level 0-1 (default: 1.0)"),
    },
    async ({ scope, note, symbol, confidence }) => {
      const store = new ObservationStore(db);

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
        sessionId: "current",
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
    }
  );
}
