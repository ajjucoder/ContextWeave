import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { fileQueries } from "../../db/queries/files.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";

interface FlowStep {
  name: string;
  kind: string;
  file: string;
  line: number;
  edgeKind: string;
}

function findPath(
  db: Database.Database,
  sourceId: number,
  targetId: number,
  maxHops: number
): FlowStep[] | null {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const files = fileQueries(db);

  const visited = new Set<number>();
  const parent = new Map<number, { from: number; edgeKind: string }>();
  const queue: Array<{ id: number; depth: number }> = [{ id: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === targetId) break;
    if (current.depth >= maxHops) continue;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    const outgoing = edges.getBySource(current.id);
    for (const edge of outgoing) {
      if (!visited.has(edge.targetSymbolId)) {
        parent.set(edge.targetSymbolId, { from: current.id, edgeKind: edge.kind });
        queue.push({ id: edge.targetSymbolId, depth: current.depth + 1 });
      }
    }
  }

  if (!parent.has(targetId) && sourceId !== targetId) return null;

  const path: FlowStep[] = [];
  let current = targetId;

  while (current !== sourceId) {
    const p = parent.get(current);
    if (!p) break;

    const symbol = symbols.getById(current);
    const file = symbol ? files.getById(symbol.fileId) : undefined;

    if (symbol) {
      path.unshift({
        name: symbol.name,
        kind: symbol.kind,
        file: file?.path ?? "unknown",
        line: symbol.startLine,
        edgeKind: p.edgeKind,
      });
    }

    current = p.from;
  }

  const sourceSymbol = symbols.getById(sourceId);
  const sourceFile = sourceSymbol ? files.getById(sourceSymbol.fileId) : undefined;
  if (sourceSymbol) {
    path.unshift({
      name: sourceSymbol.name,
      kind: sourceSymbol.kind,
      file: sourceFile?.path ?? "unknown",
      line: sourceSymbol.startLine,
      edgeKind: "origin",
    });
  }

  return path;
}

function traceOutgoing(
  db: Database.Database,
  sourceId: number,
  maxHops: number
): FlowStep[][] {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const files = fileQueries(db);

  const paths: FlowStep[][] = [];
  const visited = new Set<number>();

  function dfs(currentId: number, path: FlowStep[], depth: number): void {
    if (depth > maxHops) {
      if (path.length > 1) paths.push([...path]);
      return;
    }

    const outgoing = edges.getBySource(currentId);
    if (outgoing.length === 0 && path.length > 1) {
      paths.push([...path]);
      return;
    }

    for (const edge of outgoing) {
      if (visited.has(edge.targetSymbolId)) continue;
      visited.add(edge.targetSymbolId);

      const symbol = symbols.getById(edge.targetSymbolId);
      const file = symbol ? files.getById(symbol.fileId) : undefined;

      if (symbol) {
        path.push({
          name: symbol.name,
          kind: symbol.kind,
          file: file?.path ?? "unknown",
          line: symbol.startLine,
          edgeKind: edge.kind,
        });
        dfs(edge.targetSymbolId, path, depth + 1);
        path.pop();
      }

      visited.delete(edge.targetSymbolId);
    }
  }

  dfs(sourceId, [], 0);
  return paths.slice(0, 10);
}

function resolveSymbol(db: Database.Database, name: string): number | null {
  const symbols = symbolQueries(db);
  const files = fileQueries(db);

  // Support "file.ts:SymbolName" format
  const colonIdx = name.lastIndexOf(":");
  if (colonIdx > 0 && name.slice(0, colonIdx).includes(".")) {
    const fileSuffix = name.slice(0, colonIdx);
    const symbolName = name.slice(colonIdx + 1);
    const file = files.getByPathSuffix(fileSuffix);
    if (file) {
      const sym = symbols.getByFileAndName(file.id, symbolName);
      if (sym) return sym.id;
    }
    return null;
  }

  // Exact match first
  const exactMatches = symbols.getByName(name);
  if (exactMatches.length > 0) {
    // prefer highest centrality when multiple definitions exist
    return exactMatches.reduce((best, s) => s.centrality > best.centrality ? s : best).id;
  }

  // Fall back to fuzzy
  const allNames = symbols.getAllNames();
  const matches = fuzzyMatch(name, allNames, 0.6);
  if (matches.length === 0) return null;

  const syms = symbols.getByName(matches[0]!.name);
  return syms.length > 0
    ? syms.reduce((best, s) => s.centrality > best.centrality ? s : best).id
    : null;
}

export function registerFlowTool(server: McpServer, db: Database.Database): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    source: z.string().describe("Source symbol name"),
    target: z.string().optional().describe("Target symbol name (omit to trace all outgoing flows)"),
    max_hops: z.number().min(1).max(20).optional().describe("Maximum path length (default: 5)"),
  };

  registerTool(
    "cw_flow",
    "Trace call flow between symbols or from a symbol outward. Shows how data/control flows through the codebase.",
    inputSchema,
    async ({ source, target, max_hops }: { source: string; target?: string; max_hops?: number }) => {
      try {
      const maxHops = max_hops ?? 5;
      const sourceId = resolveSymbol(db, source);

      if (!sourceId) {
        return {
          content: [{ type: "text" as const, text: `No symbol found matching "${source}"` }],
        };
      }

      if (target) {
        const targetId = resolveSymbol(db, target);
        if (!targetId) {
          return {
            content: [{ type: "text" as const, text: `No symbol found matching "${target}"` }],
          };
        }

        const path = findPath(db, sourceId, targetId, maxHops);
        if (!path) {
          return {
            content: [{ type: "text" as const, text: `No path found from "${source}" to "${target}" within ${maxHops} hops` }],
          };
        }

        const lines = [`Flow: ${source} → ${target}\n`];
        for (let i = 0; i < path.length; i++) {
          const step = path[i]!;
          const prefix = i === 0 ? "  " : `  ${"─".repeat(i)}→ `;
          lines.push(`${prefix}[${step.edgeKind}] ${step.kind} ${step.name} (${step.file}:${step.line})`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      }

      const paths = traceOutgoing(db, sourceId, maxHops);
      if (paths.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No outgoing flows found from "${source}"` }],
        };
      }

      const lines = [`Outgoing flows from "${source}" (max ${maxHops} hops):\n`];
      for (let p = 0; p < paths.length; p++) {
        const path = paths[p]!;
        lines.push(`\nPath ${p + 1}:`);
        for (const step of path) {
          lines.push(`  [${step.edgeKind}] → ${step.kind} ${step.name} (${step.file}:${step.line})`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Flow analysis failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
