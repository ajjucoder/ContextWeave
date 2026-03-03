import type Database from "better-sqlite3";
import { dirname } from "node:path";

export interface WeightedBfsNode {
  symbolId: number;
  distance: number;
}

export interface BfsOptions {
  maxVisitedNodes?: number;
  incomingEdgeCostMultiplier?: number;
}

interface EdgeRow {
  symbol_id: number;
  kind: string;
  file_path: string;
}

const EDGE_WEIGHTS: Record<string, number> = {
  import: 0.8,
  call: 1.0,
  type_usage: 0.9,
  reference: 1.2,
  inheritance: 0.6,
  implements: 0.7,
};

function edgeCost(kind: string, sourceDir: string, targetDir: string, targetPath: string): number {
  const base = EDGE_WEIGHTS[kind] ?? 1.0;

  if (sourceDir === targetDir) return base * 0.6;

  if (/(^|[/\\])(legacy|archive|old|prototype)[/\\]/i.test(targetPath)) return base * 3.0;
  if (/_(legacy|demo|old|prototype|archive)[_/\\]/i.test(targetPath)) return base * 3.0;
  if (/\/(tests?|__tests?__|spec)\//i.test(targetPath)) return base * 1.8;
  if (/\/(vendor|third_party|external)\//i.test(targetPath)) return base * 2.5;
  if (/(^|[/\\])(examples?|samples?|demo)[/\\]/i.test(targetPath)) return base * 3.0;

  return base;
}

export function weightedBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number,
  scopeDirs?: string[] | null,
  options: BfsOptions = {}
): WeightedBfsNode[] {
  const getOutgoing = db.prepare(`
    SELECT e.target_symbol_id as symbol_id, e.kind, f.path as file_path
    FROM edges e
    JOIN symbols s ON s.id = e.target_symbol_id
    JOIN files f ON f.id = s.file_id
    WHERE e.source_symbol_id = ?
  `);
  const getIncoming = db.prepare(`
    SELECT e.source_symbol_id as symbol_id, e.kind, f.path as file_path
    FROM edges e
    JOIN symbols s ON s.id = e.source_symbol_id
    JOIN files f ON f.id = s.file_id
    WHERE e.target_symbol_id = ?
  `);
  const getFilePath = db.prepare(`
    SELECT f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ?
  `);

  const isInScope = (filePath: string): boolean => {
    if (!scopeDirs || scopeDirs.length === 0) return true;
    return scopeDirs.some((dir) => filePath.startsWith(`${dir}/`) || filePath.startsWith(`${dir}\\`));
  };

  const visited = new Map<number, number>();

  const queue: Array<{ symbolId: number; distance: number }> = [];
  const enqueue = (symbolId: number, distance: number) => {
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (queue[mid]!.distance <= distance) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, { symbolId, distance });
  };

  for (const id of pivotIds) {
    visited.set(id, 0);
    enqueue(id, 0);
  }

  const maxNodes = options.maxVisitedNodes ?? 300;
  const incomingMult = options.incomingEdgeCostMultiplier ?? 1.5;

  while (queue.length > 0) {
    if (visited.size >= maxNodes) break;

    const current = queue.shift()!;

    const bestKnown = visited.get(current.symbolId);
    if (bestKnown !== undefined && bestKnown < current.distance) continue;
    if (current.distance >= maxDepth) continue;

    const sourcePathRow = getFilePath.get(current.symbolId) as { path: string } | undefined;
    const sourceDir = sourcePathRow ? dirname(sourcePathRow.path) : "";

    const outgoing = getOutgoing.all(current.symbolId) as EdgeRow[];
    const incoming = getIncoming.all(current.symbolId) as EdgeRow[];

    for (const edge of outgoing) {
      if (!isInScope(edge.file_path)) continue;
      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path);
      const newDist = current.distance + cost;
      if (newDist >= maxDepth) continue;
      const existing = visited.get(edge.symbol_id);
      if (existing !== undefined && existing <= newDist) continue;
      visited.set(edge.symbol_id, newDist);
      enqueue(edge.symbol_id, newDist);
    }

    for (const edge of incoming) {
      if (!isInScope(edge.file_path)) continue;
      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path) * incomingMult;
      const newDist = current.distance + cost;
      if (newDist >= maxDepth) continue;
      const existing = visited.get(edge.symbol_id);
      if (existing !== undefined && existing <= newDist) continue;
      visited.set(edge.symbol_id, newDist);
      enqueue(edge.symbol_id, newDist);
    }
  }

  return Array.from(visited.entries()).map(([symbolId, distance]) => ({ symbolId, distance }));
}
