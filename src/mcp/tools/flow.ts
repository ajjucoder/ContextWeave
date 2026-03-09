import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { getRegisterTool } from "./register-helper.js";
import { fileQueries } from "../../db/queries/files.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";
import {
  formatSymbolDisplayName,
  resolveExactSymbolMatches,
} from "./symbol-resolution.js";

interface FlowStep {
  name: string;
  kind: string;
  file: string;
  line: number;
  edgeKind: string;
  edgeWeight: number;
}

const EDGE_WEIGHTS: Record<string, number> = {
  call: 1,
  import: 1,
  type_usage: 0.9,
  inheritance: 0.9,
  implements: 0.9,
  jsx_render: 0.8,
  framework_entry: 0.8,
  dynamic_dispatch: 0.7,
  callback: 0.7,
  "server-action": 0.7,
  "route-handler": 0.7,
  reexport: 0.6,
  reference: 0.5,
};

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
  const parent = new Map<number, { from: number; edgeKind: string; edgeWeight: number }>();
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
        const weight = EDGE_WEIGHTS[edge.kind] ?? 0.5;
        parent.set(edge.targetSymbolId, { from: current.id, edgeKind: edge.kind, edgeWeight: weight });
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
        name: formatSymbolDisplayName(db, symbol),
        kind: symbol.kind,
        file: file?.path ?? "unknown",
        line: symbol.startLine,
        edgeKind: p.edgeKind,
        edgeWeight: p.edgeWeight,
      });
    }

    current = p.from;
  }

  const sourceSymbol = symbols.getById(sourceId);
  const sourceFile = sourceSymbol ? files.getById(sourceSymbol.fileId) : undefined;
  if (sourceSymbol) {
    path.unshift({
      name: formatSymbolDisplayName(db, sourceSymbol),
      kind: sourceSymbol.kind,
      file: sourceFile?.path ?? "unknown",
      line: sourceSymbol.startLine,
      edgeKind: "origin",
      edgeWeight: 1,
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

  const MAX_PATHS = 10;
  const paths: FlowStep[][] = [];
  const visited = new Set<number>();

  function dfs(currentId: number, path: FlowStep[], depth: number): void {
    if (paths.length >= MAX_PATHS) return;
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
      if (paths.length >= MAX_PATHS) return;
      if (visited.has(edge.targetSymbolId)) continue;
      visited.add(edge.targetSymbolId);

      const symbol = symbols.getById(edge.targetSymbolId);
      const file = symbol ? files.getById(symbol.fileId) : undefined;

      if (symbol) {
        const weight = EDGE_WEIGHTS[edge.kind] ?? 0.5;
        path.push({
          name: formatSymbolDisplayName(db, symbol),
          kind: symbol.kind,
          file: file?.path ?? "unknown",
          line: symbol.startLine,
          edgeKind: edge.kind,
          edgeWeight: weight,
        });
        dfs(edge.targetSymbolId, path, depth + 1);
        path.pop();
      }

      visited.delete(edge.targetSymbolId);
    }
  }

  dfs(sourceId, [], 0);
  return paths;
}

function resolveSymbol(db: Database.Database, name: string): number | null {
  return resolveSymbolCandidates(db, name, 1)[0] ?? null;
}

function resolveSymbolCandidates(
  db: Database.Database,
  name: string,
  limit = 12
): number[] {
  const symbols = symbolQueries(db);
  const exactMatches = resolveExactSymbolMatches(db, name);
  if (exactMatches.length > 0) {
    return exactMatches.slice(0, limit).map((symbol) => symbol.id);
  }

  const allNames = symbols.getAllNames();
  const matches = fuzzyMatch(name, allNames, 0.6);
  if (matches.length === 0) return [];

  return symbols
    .getByName(matches[0]!.name)
    .sort((a, b) => b.centrality - a.centrality || a.fileId - b.fileId || a.startLine - b.startLine)
    .slice(0, limit)
    .map((symbol) => symbol.id);
}

export interface FlowResult {
  text: string;
  isLimited: boolean;
}

export function buildFlowResult(
  db: Database.Database,
  source: string,
  target: string | undefined,
  maxHops: number
): FlowResult {
  const symbols = symbolQueries(db);
  const files = fileQueries(db);

  const sourceId = resolveSymbol(db, source);
  if (!sourceId) {
    return { text: `No symbol found matching "${source}"`, isLimited: false };
  }

  if (target) {
    const sourceCandidates = resolveSymbolCandidates(db, source);
    if (sourceCandidates.length === 0) {
      return { text: `No symbol found matching "${source}"`, isLimited: false };
    }

    const targetCandidates = resolveSymbolCandidates(db, target);
    if (targetCandidates.length === 0) {
      return { text: `No symbol found matching "${target}"`, isLimited: false };
    }

    let bestPath: FlowStep[] | null = null;
    for (const sourceCandidate of sourceCandidates) {
      for (const targetCandidate of targetCandidates) {
        const path = findPath(db, sourceCandidate, targetCandidate, maxHops);
        if (!path) continue;
        if (!bestPath || path.length < bestPath.length) {
          bestPath = path;
        }
      }
    }

    if (!bestPath) {
      return {
        text: `No path found from "${source}" to "${target}" within ${maxHops} hops`,
        isLimited: false,
      };
    }
    const lines = [`Flow: ${source} → ${target}\n`];
    for (let i = 0; i < bestPath.length; i++) {
      const step = bestPath[i]!;
      const prefix = i === 0 ? "  " : `  ${"─".repeat(i)}→ `;
      lines.push(`${prefix}[${step.edgeKind}] ${step.kind} ${step.name} (${step.file}:${step.line})`);
    }
    return { text: lines.join("\n"), isLimited: false };
  }

  const paths = traceOutgoing(db, sourceId, maxHops);
  if (paths.length === 0) {
    const sym = symbols.getById(sourceId);
    const file = sym ? files.getById(sym.fileId) : undefined;
    const location = file && sym ? `${file.path}:${sym.startLine}` : "unknown";
    const text = [
      `No outgoing flows found from "${source}" (flows_limited: true).`,
      `Symbol location: ${location}`,
      `Reason: analysis covers call, callback, server-action, and route-handler edges.`,
      `Higher-order functions and dynamic dispatch patterns may still be missing.`,
      `Recommendation: use cw_read to inspect "${source}" directly.`,
    ].join("\n");
    return { text, isLimited: true };
  }

  const lines = [`Outgoing flows from "${source}" (max ${maxHops} hops):\n`];
  for (let p = 0; p < paths.length; p++) {
    const path = paths[p]!;
    lines.push(`\nPath ${p + 1}:`);
    for (const step of path) {
      lines.push(`  [${step.edgeKind}] → ${step.kind} ${step.name} (${step.file}:${step.line})`);
    }
  }
  return { text: lines.join("\n"), isLimited: false };
}

export function registerFlowTool(server: McpServer, db: Database.Database): void {
  const registerTool = getRegisterTool(server);
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
        const result = buildFlowResult(db, source, target, maxHops);
        return { content: [{ type: "text" as const, text: result.text }] };
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
