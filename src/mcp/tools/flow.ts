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
  event: 0.8,
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

interface TracedPath {
  steps: FlowStep[];
  firstHop: number | null;
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
  const allPaths: TracedPath[] = [];
  const visited = new Set<number>();

  function dfs(currentId: number, path: FlowStep[], depth: number, firstHopId: number | null): void {
    if (allPaths.length >= MAX_PATHS * 3) return;
    if (depth > maxHops) {
      if (path.length > 0) allPaths.push({ steps: [...path], firstHop: firstHopId });
      return;
    }

    const outgoing = edges.getBySource(currentId);
    if (outgoing.length === 0 && path.length > 0) {
      allPaths.push({ steps: [...path], firstHop: firstHopId });
      return;
    }

    for (const edge of outgoing) {
      if (allPaths.length >= MAX_PATHS * 3) return;
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
        const hop = firstHopId ?? edge.targetSymbolId;
        dfs(edge.targetSymbolId, path, depth + 1, hop);
        path.pop();
      }

      visited.delete(edge.targetSymbolId);
    }
  }

  dfs(sourceId, [], 0, null);

  // Filter out paths that consist solely of import/reexport edges — these represent
  // module structure rather than execution flow.
  const PASSIVE_EDGE_KINDS = new Set(["import", "reexport"]);
  const meaningfulPaths = allPaths.filter((p) =>
    p.steps.some((step) => !PASSIVE_EDGE_KINDS.has(step.edgeKind))
  );
  const pathsToGroup = meaningfulPaths.length > 0 ? meaningfulPaths : allPaths;

  const grouped = new Map<number | null, TracedPath[]>();
  for (const p of pathsToGroup) {
    const bucket = grouped.get(p.firstHop) ?? [];
    bucket.push(p);
    grouped.set(p.firstHop, bucket);
  }

  const result: FlowStep[][] = [];
  const buckets = [...grouped.values()];
  let round = 0;
  const perBranchLimit = 2;
  while (result.length < MAX_PATHS) {
    let added = false;
    for (const bucket of buckets) {
      const start = round * perBranchLimit;
      const slice = bucket.slice(start, start + perBranchLimit);
      for (const entry of slice) {
        if (result.length >= MAX_PATHS) break;
        result.push(entry.steps);
        added = true;
      }
      if (result.length >= MAX_PATHS) break;
    }
    if (!added) break;
    round++;
  }

  return result;
}

function traceIncoming(
  db: Database.Database,
  targetId: number,
  maxHops: number
): FlowStep[][] {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const files = fileQueries(db);

  const MAX_PATHS = 10;
  const allPaths: TracedPath[] = [];
  const visited = new Set<number>();

  function dfs(currentId: number, path: FlowStep[], depth: number, firstHopId: number | null): void {
    if (allPaths.length >= MAX_PATHS * 3) return;
    if (depth > maxHops) {
      if (path.length > 0) allPaths.push({ steps: [...path], firstHop: firstHopId });
      return;
    }

    const incoming = edges.getByTarget(currentId);
    if (incoming.length === 0 && path.length > 0) {
      allPaths.push({ steps: [...path], firstHop: firstHopId });
      return;
    }

    for (const edge of incoming) {
      if (allPaths.length >= MAX_PATHS * 3) return;
      if (visited.has(edge.sourceSymbolId)) continue;
      visited.add(edge.sourceSymbolId);

      const symbol = symbols.getById(edge.sourceSymbolId);
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
        const hop = firstHopId ?? edge.sourceSymbolId;
        dfs(edge.sourceSymbolId, path, depth + 1, hop);
        path.pop();
      }

      visited.delete(edge.sourceSymbolId);
    }
  }

  dfs(targetId, [], 0, null);

  const PASSIVE_EDGE_KINDS = new Set(["import", "reexport"]);
  const meaningfulPaths = allPaths.filter((p) =>
    p.steps.some((step) => !PASSIVE_EDGE_KINDS.has(step.edgeKind))
  );
  const pathsToGroup = meaningfulPaths.length > 0 ? meaningfulPaths : allPaths;

  const grouped = new Map<number | null, TracedPath[]>();
  for (const p of pathsToGroup) {
    const bucket = grouped.get(p.firstHop) ?? [];
    bucket.push(p);
    grouped.set(p.firstHop, bucket);
  }

  const result: FlowStep[][] = [];
  const buckets = [...grouped.values()];
  let round = 0;
  const perBranchLimit = 2;
  while (result.length < MAX_PATHS) {
    let added = false;
    for (const bucket of buckets) {
      const start = round * perBranchLimit;
      const slice = bucket.slice(start, start + perBranchLimit);
      for (const entry of slice) {
        if (result.length >= MAX_PATHS) break;
        result.push(entry.steps);
        added = true;
      }
      if (result.length >= MAX_PATHS) break;
    }
    if (!added) break;
    round++;
  }

  return result;
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

  if (name.includes(".")) {
    const byQualified = symbols.getByQualifiedName(name);
    if (byQualified.length > 0) {
      return byQualified
        .sort((a, b) => b.centrality - a.centrality)
        .slice(0, limit)
        .map((s) => s.id);
    }
    const simpleName = name.split(".").pop()!;
    const exactMatches = resolveExactSymbolMatches(db, simpleName);
    if (exactMatches.length > 0) {
      return exactMatches.slice(0, limit).map((symbol) => symbol.id);
    }
    const allNames = symbols.getAllNames();
    const matches = fuzzyMatch(simpleName, allNames, 0.6);
    if (matches.length === 0) return [];
    return symbols
      .getByName(matches[0]!.name)
      .sort((a, b) => b.centrality - a.centrality || a.fileId - b.fileId || a.startLine - b.startLine)
      .slice(0, limit)
      .map((symbol) => symbol.id);
  }

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
  maxHops: number,
  direction: "outgoing" | "incoming" | "both" = "outgoing"
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

  if (direction === "incoming") {
    const paths = traceIncoming(db, sourceId, maxHops);
    if (paths.length === 0) {
      const sym = symbols.getById(sourceId);
      const file = sym ? files.getById(sym.fileId) : undefined;
      const location = file && sym ? `${file.path}:${sym.startLine}` : "unknown";
      const text = [
        `No incoming flows found for "${source}" (flows_limited: true).`,
        `Symbol location: ${location}`,
        `Reason: no symbols call or reference this symbol within the indexed codebase.`,
        `Recommendation: use cw_read to inspect "${source}" directly.`,
      ].join("\n");
      return { text, isLimited: true };
    }
    const lines = [`Incoming flows to "${source}" (max ${maxHops} hops):\n`];
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p]!;
      lines.push(`\nPath ${p + 1}:`);
      for (const step of path) {
        lines.push(`  [${step.edgeKind}] ← ${step.kind} ${step.name} (${step.file}:${step.line})`);
      }
    }
    return { text: lines.join("\n"), isLimited: false };
  }

  if (direction === "both") {
    const outPaths = traceOutgoing(db, sourceId, maxHops);
    const inPaths = traceIncoming(db, sourceId, maxHops);
    const lines: string[] = [];

    if (outPaths.length > 0) {
      lines.push(`Outgoing flows from "${source}" (max ${maxHops} hops):\n`);
      for (let p = 0; p < outPaths.length; p++) {
        const path = outPaths[p]!;
        lines.push(`\nPath ${p + 1}:`);
        for (const step of path) {
          lines.push(`  [${step.edgeKind}] → ${step.kind} ${step.name} (${step.file}:${step.line})`);
        }
      }
    } else {
      lines.push(`No outgoing flows from "${source}".`);
    }

    if (inPaths.length > 0) {
      lines.push(`\nIncoming flows to "${source}" (max ${maxHops} hops):\n`);
      for (let p = 0; p < inPaths.length; p++) {
        const path = inPaths[p]!;
        lines.push(`\nPath ${p + 1}:`);
        for (const step of path) {
          lines.push(`  [${step.edgeKind}] ← ${step.kind} ${step.name} (${step.file}:${step.line})`);
        }
      }
    } else {
      lines.push(`No incoming flows to "${source}".`);
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
    direction: z
      .enum(["outgoing", "incoming", "both"])
      .optional()
      .describe("Flow direction: outgoing (default), incoming (find callers), or both"),
  };

  registerTool(
    "cw_flow",
    "Trace call flow between symbols or from a symbol outward. Shows how data/control flows through the codebase.",
    inputSchema,
    async ({
      source,
      target,
      max_hops,
      direction,
    }: {
      source: string;
      target?: string;
      max_hops?: number;
      direction?: "outgoing" | "incoming" | "both";
    }) => {
      try {
        const maxHops = max_hops ?? 5;
        const result = buildFlowResult(db, source, target, maxHops, direction ?? "outgoing");
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
