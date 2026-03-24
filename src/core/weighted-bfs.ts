import type Database from "better-sqlite3";
import { dirname } from "node:path";
import type { EdgeKind } from "./types.js";

export interface WeightedBfsNode {
  symbolId: number;
  distance: number;
  weightBoost: number;
}

export interface WeightedBfsSeed {
  symbolId: number;
  distance?: number;
  weightBoost?: number;
}

export interface BfsOptions {
  maxVisitedNodes?: number;
  incomingEdgeCostMultiplier?: number;
  maxHops?: number;
  direction?: "outgoing" | "incoming" | "both";
}

interface EdgeRow {
  symbol_id: number;
  kind: string;
  strength: number;
  file_path: string;
}

const EDGE_KIND_COST_MULTIPLIERS: Partial<Record<EdgeKind, number>> = {
  reexport: 0.1,
  dynamic_dispatch: 0.7,
  inheritance: 0.6,
  implements: 0.7,
  jsx_render: 0.8,
  framework_entry: 0.55,
  callback: 0.7,
  "server-action": 0.7,
  "route-handler": 0.7,
  event: 0.8,
};

function edgeCost(edge: EdgeRow, sourceDir: string, targetDir: string): number {
  const strength = edge.strength > 0 ? edge.strength : 1.0;
  const base = (EDGE_KIND_COST_MULTIPLIERS[edge.kind as EdgeKind] ?? 1.0) / strength;

  if (sourceDir === targetDir) return base * 0.6;

  if (/(^|[/\\])(legacy|archive|old|prototype)[/\\]/i.test(edge.file_path)) return base * 3.0;
  if (/_(legacy|demo|old|prototype|archive)[_/\\]/i.test(edge.file_path)) return base * 3.0;
  if (/\/(tests?|__tests?__|spec)\//i.test(edge.file_path)) return base * 1.8;
  if (/\/(vendor|third_party|external)\//i.test(edge.file_path)) return base * 2.5;
  if (/(^|[/\\])(examples?|samples?|demo)[/\\]/i.test(edge.file_path)) return base * 3.0;

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
      SELECT e.target_symbol_id as symbol_id, e.kind, e.strength, f.path as file_path
      FROM edges e
      JOIN symbols s ON s.id = e.target_symbol_id
      JOIN files f ON f.id = s.file_id
      WHERE e.source_symbol_id = ?
    `),
    getIncoming: db.prepare(`
      SELECT e.source_symbol_id as symbol_id, e.kind, e.strength, f.path as file_path
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
  pivotIds: Array<number | WeightedBfsSeed>,
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
  const visitedBoosts = new Map<number, number>();
  const visitedHops = new Map<number, number>();

  const queue: Array<{ symbolId: number; distance: number; hopCount: number; weightBoost: number }> = [];
  const enqueue = (symbolId: number, distance: number, hopCount: number, weightBoost: number) => {
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (queue[mid]!.distance <= distance) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, { symbolId, distance, hopCount, weightBoost });
  };

  for (const pivot of pivotIds) {
    const seed = typeof pivot === "number" ? { symbolId: pivot, distance: 0, weightBoost: 1 } : pivot;
    const distance = seed.distance ?? 0;
    const weightBoost = seed.weightBoost ?? 1;
    visited.set(seed.symbolId, distance);
    visitedBoosts.set(seed.symbolId, weightBoost);
    visitedHops.set(seed.symbolId, 0);
    enqueue(seed.symbolId, distance, 0, weightBoost);
  }

  const maxNodes = options.maxVisitedNodes ?? 300;
  const incomingMult = options.incomingEdgeCostMultiplier ?? 1.5;
  const maxHops = options.maxHops;
  const direction = options.direction ?? "both";

  while (queue.length > 0) {
    if (visited.size >= maxNodes) break;

    const current = queue.shift()!;

    const bestKnown = visited.get(current.symbolId);
    if (bestKnown !== undefined && bestKnown < current.distance) continue;
    const bestBoost = visitedBoosts.get(current.symbolId) ?? 1;
    if (bestKnown === current.distance && bestBoost > current.weightBoost) continue;
    if (current.distance >= maxCost) continue;
    if (maxHops !== undefined && current.hopCount >= maxHops) continue;

    const sourcePathRow = getFilePath.get(current.symbolId) as { path: string } | undefined;
    const sourceDir = sourcePathRow ? dirname(sourcePathRow.path) : "";

    const outgoing = direction !== "incoming" ? getOutgoing.all(current.symbolId) as EdgeRow[] : [];
    const incoming = direction !== "outgoing" ? getIncoming.all(current.symbolId) as EdgeRow[] : [];
    const newHopCount = current.hopCount + 1;

    for (const edge of outgoing) {
      if (!isInScope(edge.file_path)) continue;
      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge, sourceDir, targetDir);
      const newDist = current.distance + cost;
      if (newDist >= maxCost) continue;
      const existing = visited.get(edge.symbol_id);
      const existingBoost = visitedBoosts.get(edge.symbol_id) ?? 1;
      if (existing !== undefined && (existing < newDist || (existing === newDist && existingBoost >= current.weightBoost))) {
        continue;
      }
      visited.set(edge.symbol_id, newDist);
      visitedBoosts.set(edge.symbol_id, current.weightBoost);
      visitedHops.set(edge.symbol_id, newHopCount);
      enqueue(edge.symbol_id, newDist, newHopCount, current.weightBoost);
    }

    for (const edge of incoming) {
      if (!isInScope(edge.file_path)) continue;
      const targetDir = dirname(edge.file_path);
      const cost = edgeCost(edge, sourceDir, targetDir) * incomingMult;
      const newDist = current.distance + cost;
      if (newDist >= maxCost) continue;
      const existing = visited.get(edge.symbol_id);
      const existingBoost = visitedBoosts.get(edge.symbol_id) ?? 1;
      if (existing !== undefined && (existing < newDist || (existing === newDist && existingBoost >= current.weightBoost))) {
        continue;
      }
      visited.set(edge.symbol_id, newDist);
      visitedBoosts.set(edge.symbol_id, current.weightBoost);
      visitedHops.set(edge.symbol_id, newHopCount);
      enqueue(edge.symbol_id, newDist, newHopCount, current.weightBoost);
    }
  }

  return Array.from(visited.entries()).map(([symbolId, distance]) => ({
    symbolId,
    distance,
    weightBoost: visitedBoosts.get(symbolId) ?? 1,
  }));
}
