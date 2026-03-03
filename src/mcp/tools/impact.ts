import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { dirname } from "node:path";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { fileQueries } from "../../db/queries/files.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";
import type { SymbolRecord } from "../../core/types.js";

interface ImpactNode {
  name: string;
  kind: string;
  file: string;
  line: number;
  depth: number;
  edgeKind: string;
}

export function traceImpact(db: Database.Database, symbolId: number, maxDepth: number): ImpactNode[] {
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

function traceImpactWithBarrelAliases(
  db: Database.Database,
  pivot: SymbolRecord,
  maxDepth: number
): ImpactNode[] {
  const symbols = symbolQueries(db);
  const files = fileQueries(db);
  const traceIds = new Set<number>([pivot.id]);
  const pivotFile = files.getById(pivot.fileId);

  if (pivotFile) {
    const pivotDir = dirname(pivotFile.path);
    const pivotIsBarrel = /(^|[/\\])(index|barrel)\.[cm]?[jt]sx?$/i.test(pivotFile.path);
    for (const candidate of symbols.getByName(pivot.name)) {
      if (candidate.id === pivot.id || candidate.kind !== pivot.kind) continue;
      const candidateFile = files.getById(candidate.fileId);
      if (!candidateFile || dirname(candidateFile.path) !== pivotDir) continue;
      const candidateIsBarrel = /(^|[/\\])(index|barrel)\.[cm]?[jt]sx?$/i.test(candidateFile.path);
      if (pivotIsBarrel || candidateIsBarrel) traceIds.add(candidate.id);
    }
  }

  const seen = new Set<string>();
  const merged: ImpactNode[] = [];
  for (const id of traceIds) {
    for (const node of traceImpact(db, id, maxDepth)) {
      const key = `${node.file}:${node.line}:${node.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(node);
    }
  }

  return merged;
}

function resolveTargetSymbols(
  db: Database.Database,
  target: string
): { symbols: SymbolRecord[]; resolvedName: string } | null {
  const symbols = symbolQueries(db);
  const files = fileQueries(db);

  // Support "file.ts:SymbolName" format for unambiguous resolution
  const colonIdx = target.lastIndexOf(":");
  if (colonIdx > 0 && target.slice(0, colonIdx).includes(".")) {
    const fileSuffix = target.slice(0, colonIdx);
    const symbolName = target.slice(colonIdx + 1);
    const file = files.getByPathSuffix(fileSuffix);
    if (file) {
      const sym = symbols.getByFileAndName(file.id, symbolName);
      if (sym) return { symbols: [sym], resolvedName: `${fileSuffix}:${symbolName}` };
    }
    return null;
  }

  // Try exact name match first before fuzzy
  const exactMatches = symbols.getByName(target);
  if (exactMatches.length > 0) {
    return { symbols: exactMatches, resolvedName: target };
  }

  // Fall back to fuzzy match
  const allNames = symbols.getAllNames();
  const matches = fuzzyMatch(target, allNames, 0.6);
  if (matches.length === 0) return null;

  const pivotName = matches[0]!.name;
  const pivotSymbols = symbols.getByName(pivotName);
  if (pivotSymbols.length === 0) return null;

  return { symbols: pivotSymbols, resolvedName: pivotName };
}

export function registerImpactTool(server: McpServer, db: Database.Database): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);

  registerTool(
    "cw_impact",
    "Analyze what breaks if a symbol or file changes. Shows dependent symbols that would be affected. Accepts 'file.ts:SymbolName' format to disambiguate symbols with common names.",
    {
      target: z.string().describe("Symbol name, or 'file.ts:SymbolName' for unambiguous resolution"),
      depth: z.number().min(1).max(20).optional().describe("Max depth of impact analysis (default: 3)"),
    },
    async ({ target, depth }: { target: string; depth?: number }) => {
      try {
        const maxDepth = depth ?? 3;

        const resolved = resolveTargetSymbols(db, target);
        if (!resolved) {
          return {
            content: [{ type: "text" as const, text: `No symbols found matching "${target}". Try 'file.ts:SymbolName' format for disambiguation.` }],
          };
        }

        const { symbols: pivotSymbols, resolvedName } = resolved;

        // Trace impact for all resolved symbols (handles barrel re-exports:
        // same-named symbols in index.ts re-exports are traced separately)
        const seen = new Set<string>();
        const allImpacts: ImpactNode[] = [];
        for (const pivot of pivotSymbols) {
          for (const node of traceImpactWithBarrelAliases(db, pivot, maxDepth)) {
            const key = `${node.file}:${node.line}:${node.name}`;
            if (!seen.has(key)) {
              seen.add(key);
              allImpacts.push(node);
            }
          }
        }

        if (allImpacts.length === 0) {
          const locHint = pivotSymbols.length === 1
            ? ` (${pivotSymbols[0]!.kind} in ${pivotSymbols[0]!.fileId})`
            : ` (${pivotSymbols.length} definitions found)`;
          return {
            content: [{ type: "text" as const, text: `No dependents found for "${resolvedName}"${locHint}` }],
          };
        }

        const lines = [`Impact analysis for "${resolvedName}" (depth ${maxDepth}):\n`];
        if (pivotSymbols.length > 1) {
          lines.push(`Note: traced ${pivotSymbols.length} symbols with this name (including barrel re-exports)\n`);
        }

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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Impact analysis failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
