import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { fileQueries } from "../../db/queries/files.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";

interface ImpactNode {
  name: string;
  kind: string;
  file: string;
  line: number;
  depth: number;
  edgeKind: string;
}

function traceImpact(db: Database.Database, symbolId: number, maxDepth: number): ImpactNode[] {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const files = fileQueries(db);

  const result: ImpactNode[] = [];
  const visited = new Set<number>();
  const queue: Array<{ id: number; depth: number; edgeKind: string }> = [
    { id: symbolId, depth: 0, edgeKind: "root" },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    if (current.depth > maxDepth) continue;
    visited.add(current.id);

    const symbol = symbols.getById(current.id);
    if (!symbol) continue;

    const file = files.getById(symbol.fileId);

    if (current.depth > 0) {
      result.push({
        name: symbol.name,
        kind: symbol.kind,
        file: file?.path ?? "unknown",
        line: symbol.startLine,
        depth: current.depth,
        edgeKind: current.edgeKind,
      });
    }

    const dependents = edges.getByTarget(current.id);
    for (const edge of dependents) {
      if (!visited.has(edge.sourceSymbolId)) {
        queue.push({
          id: edge.sourceSymbolId,
          depth: current.depth + 1,
          edgeKind: edge.kind,
        });
      }
    }
  }

  return result;
}

export function registerImpactTool(server: McpServer, db: Database.Database): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);

  registerTool(
    "cw_impact",
    "Analyze what breaks if a symbol or file changes. Shows dependent symbols that would be affected.",
    {
      target: z.string().describe("Symbol name or file path to analyze impact for"),
      depth: z.number().optional().describe("Max depth of impact analysis (default: 3)"),
    },
    async ({ target, depth }: { target: string; depth?: number }) => {
      const maxDepth = depth ?? 3;
      const symbols = symbolQueries(db);
      const allNames = symbols.getAllNames();

      const matches = fuzzyMatch(target, allNames, 0.6);
      if (matches.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No symbols found matching "${target}"` }],
        };
      }

      const pivotName = matches[0]!.name;
      const pivotSymbols = symbols.getByName(pivotName);
      if (pivotSymbols.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No symbols found for "${pivotName}"` }],
        };
      }

      const allImpacts: ImpactNode[] = [];
      for (const pivot of pivotSymbols) {
        allImpacts.push(...traceImpact(db, pivot.id, maxDepth));
      }

      if (allImpacts.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No dependents found for "${pivotName}"` }],
        };
      }

      const lines = [`Impact analysis for "${pivotName}" (depth ${maxDepth}):\n`];
      const byDepth = new Map<number, ImpactNode[]>();
      for (const node of allImpacts) {
        const existing = byDepth.get(node.depth) ?? [];
        existing.push(node);
        byDepth.set(node.depth, existing);
      }

      for (const [d, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push(`\nDepth ${d}:`);
        for (const node of nodes) {
          lines.push(`  ${node.edgeKind} → ${node.kind} ${node.name} (${node.file}:${node.line})`);
        }
      }

      lines.push(`\nTotal: ${allImpacts.length} affected symbols`);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
