import type Database from "better-sqlite3";
import { dirname } from "node:path";

export interface WeightedBfsNode {
  symbolId: number;
  distance: number;
}

export interface BfsOptions {
  maxVisitedNodes?: number;
  incomingEdgeCostMultiplier?: number;
  maxHops?: number;
}

interface EdgeRow {
  symbol_id: number;
  kind: string;
  file_path: string;
}

const EDGE_WEIGHTS: Record<string, number> = {
  import: 0.8,
  reexport: 0.1,
  call: 1.0,
  type_usage: 0.9,
  reference: 1.2,
  inheritance: 0.6,
  implements: 0.7,
  jsx_render: 0.8,
  framework_entry: 0.55,
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

interface BfsStatements {
  getOutgoing: ReturnType<Database.Database["prepare"]>;
  getIncoming: ReturnType<Database.Database["prepare"]>;
  getFilePath: ReturnType<Database.Database["prepare"]>;
}

const bfsStmtCache = new WeakMap<Database.Database, BfsStatements>();

function getBfsStatements(db: Database.Database): BfsStatements {
  const cached = bfsStmtCache.get(db);
  if (cached) return cached;
  const stmts: BfsStatements = {
    getOutgoing: db.prepare(`
      SELECT e.target_symbol_id as symbol_id, e.kind, f.path as file_path
      FROM edges e
      JOIN symbols s ON s.id = e.target_symbol_id
      JOIN files f ON f.id = s.file_id
      WHERE e.source_symbol_id = ?
    `),
    getIncoming: db.prepare(`
      SELECT e.source_symbol_id as symbol_id, e.kind, f.path as file_path
      FROM edges e
      JOIN symbols s ON s.id = e.source_symbol_id
      JOIN files f ON f.id = s.file_id
      WHERE e.target_symbol_id = ?
    `),
    getFilePath: db.prepare(`
      SELECT f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id = ?
    `),
  };
  bfsStmtCache.set(db, stmts);
  return stmts;
}

export function weightedBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxCost: number,
  scopeDirs?: string[] | null,
  options: BfsOptions = {}
): WeightedBfsNode[] {
  const { getOutgoing, getIncoming, getFilePath } = getBfsStatements(db);

  const isInScope = (filePath: string): boolean => {
    if (!scopeDirs || scopeDirs.length === 0) return true;
    return scopeDirs.some((dir) => filePath.startsWith(`${dir}/`) || filePath.startsWith(`${dir}\\`));
  };

  const visited = new Map<number, number>();
  const visitedHops = new Map<number, number>();

  const queue: Array<{ symbolId: number; distance: number; hopCount: number }> = [];
  const enqueue = (symbolId: number, distance: number, hopCount: number) => {
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (queue[mid]!.distance <= distance) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, { symbolId, distance, hopCount });
  };

  for (const id of pivotIds) {
    visited.set(id, 0);
    visitedHops.set(id, 0);
    enqueue(id, 0, 0);
  }

  const maxNodes = options.maxVisitedNodes ?? 300;
  const incomingMult = options.incomingEdgeCostMultiplier ?? 1.5;
  const maxHops = options.maxHops;

  while (queue.length > 0) {
    if (visited.size >= maxNodes) break;

    const current = queue.shift()!;

    const bestKnown = visited.get(current.symbolId);
    if (bestKnown !== undefined && bestKnown < current.distance) continue;
    if (current.distance >= maxCost) continue;
    if (maxHops !== undefined && current.hopCount >= maxHops) continue;

    const sourcePathRow = getFilePath.get(current.symbolId) as { path: string } | undefined;
    const sourceDir = sourcePathRow ? dirname(sourcePathRow.path) : "";

    const outgoing = getOutgoing.all(current.symbolId) as EdgeRow[];
    const incoming = getIncoming.all(current.symbolId) as EdgeRow[];
    const newHopCount = current.hopCount + 1;

    for (const edge of outgoing) {
      if (!isInScope(edge.file_path)) continue;
      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path);
      const newDist = current.distance + cost;
      if (newDist >= maxCost) continue;
      const existing = visited.get(edge.symbol_id);
      if (existing !== undefined && existing <= newDist) continue;
      visited.set(edge.symbol_id, newDist);
      visitedHops.set(edge.symbol_id, newHopCount);
      enqueue(edge.symbol_id, newDist, newHopCount);
    }

    for (const edge of incoming) {
      if (!isInScope(edge.file_path)) continue;
      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge.kind, sourceDir, targetDir, edge.file_path) * incomingMult;
      const newDist = current.distance + cost;
      if (newDist >= maxCost) continue;
      const existing = visited.get(edge.symbol_id);
      if (existing !== undefined && existing <= newDist) continue;
      visited.set(edge.symbol_id, newDist);
      visitedHops.set(edge.symbol_id, newHopCount);
      enqueue(edge.symbol_id, newDist, newHopCount);
    }
  }

  return Array.from(visited.entries()).map(([symbolId, distance]) => ({ symbolId, distance }));
}
