import type Database from "better-sqlite3";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("graph");
const PAGERANK_WORKER = join(dirname(fileURLToPath(import.meta.url)), "pagerank-worker.js");
const USE_TSX_WORKER_LOADER = PAGERANK_WORKER.includes(`${sep}src${sep}`);

export interface BfsNode {
  symbolId: number;
  distance: number;
}

export interface AdjacencyMap {
  outgoing: Map<number, number[]>;
  incoming: Map<number, number[]>;
  degree: Map<number, number>;
}

export function buildAdjacencyMap(db: Database.Database): AdjacencyMap {
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();
  const degree = new Map<number, number>();

  for (const edge of edgeQueries(db).getAll()) {
    const out = outgoing.get(edge.sourceSymbolId);
    if (out) out.push(edge.targetSymbolId);
    else outgoing.set(edge.sourceSymbolId, [edge.targetSymbolId]);

    const inc = incoming.get(edge.targetSymbolId);
    if (inc) inc.push(edge.sourceSymbolId);
    else incoming.set(edge.targetSymbolId, [edge.sourceSymbolId]);

    degree.set(edge.sourceSymbolId, (degree.get(edge.sourceSymbolId) ?? 0) + 1);
    degree.set(edge.targetSymbolId, (degree.get(edge.targetSymbolId) ?? 0) + 1);
  }

  return { outgoing, incoming, degree };
}

export function bfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number,
  adjacency?: AdjacencyMap
): BfsNode[] {
  const graph = adjacency ?? buildAdjacencyMap(db);
  const visited = new Map<number, number>();
  const queue: BfsNode[] = [];

  for (const id of pivotIds) {
    visited.set(id, 0);
    queue.push({ symbolId: id, distance: 0 });
  }

  let head = 0;

  while (head < queue.length) {
    const current = queue[head]!;
    head++;

    if (current.distance >= maxDepth) continue;

    const outgoing = graph.outgoing.get(current.symbolId) ?? [];
    const incoming = graph.incoming.get(current.symbolId) ?? [];
    const neighbors = [
      ...outgoing,
      ...incoming,
    ];

    for (const neighborId of neighbors) {
      const existingDistance = visited.get(neighborId);
      if (existingDistance !== undefined && existingDistance <= current.distance + 1) continue;

      const newDistance = current.distance + 1;
      visited.set(neighborId, newDistance);
      queue.push({ symbolId: neighborId, distance: newDistance });
    }
  }

  const result: BfsNode[] = [];
  for (const [symbolId, distance] of visited) {
    result.push({ symbolId, distance });
  }

  return result;
}

export function lazyBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number
): BfsNode[] {
  const getOutgoing = db.prepare("SELECT target_symbol_id FROM edges WHERE source_symbol_id = ?");
  const getIncoming = db.prepare("SELECT source_symbol_id FROM edges WHERE target_symbol_id = ?");

  const visited = new Map<number, number>();
  const queue: BfsNode[] = [];

  for (const id of pivotIds) {
    visited.set(id, 0);
    queue.push({ symbolId: id, distance: 0 });
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    if (current.distance >= maxDepth) continue;

    const outgoing = (getOutgoing.all(current.symbolId) as Array<{ target_symbol_id: number }>)
      .map((r) => r.target_symbol_id);
    const incoming = (getIncoming.all(current.symbolId) as Array<{ source_symbol_id: number }>)
      .map((r) => r.source_symbol_id);

    for (const neighborId of [...outgoing, ...incoming]) {
      const existing = visited.get(neighborId);
      const newDist = current.distance + 1;
      if (existing !== undefined && existing <= newDist) continue;
      visited.set(neighborId, newDist);
      queue.push({ symbolId: neighborId, distance: newDist });
    }
  }

  return Array.from(visited.entries()).map(([symbolId, distance]) => ({ symbolId, distance }));
}

export function getSymbolDegree(db: Database.Database, symbolId: number): number {
  const out = db.prepare("SELECT COUNT(*) as c FROM edges WHERE source_symbol_id = ?").get(symbolId) as { c: number };
  const inc = db.prepare("SELECT COUNT(*) as c FROM edges WHERE target_symbol_id = ?").get(symbolId) as { c: number };
  return out.c + inc.c;
}

const DAMPING = 0.85;
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 1e-6;

export function computePageRank(db: Database.Database): Map<number, number> {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);

  const symbolIds = symbols.getAllIds();
  const allEdges = edges.getAll();

  if (symbolIds.length === 0) return new Map();

  const n = symbolIds.length;
  const idToIndex = new Map(symbolIds.map((id, i) => [id, i]));

  const outLinks = new Map<number, number[]>();
  for (const edge of allEdges) {
    const sourceIdx = idToIndex.get(edge.sourceSymbolId);
    const targetIdx = idToIndex.get(edge.targetSymbolId);
    if (sourceIdx === undefined || targetIdx === undefined) continue;

    const existing = outLinks.get(sourceIdx) ?? [];
    existing.push(targetIdx);
    outLinks.set(sourceIdx, existing);
  }

  let ranks = new Float64Array(n).fill(1 / n);
  let newRanks = new Float64Array(n);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      const links = outLinks.get(i);
      if (!links || links.length === 0) {
        danglingSum += ranks[i]!;
      }
    }
    const danglingContribution = (DAMPING * danglingSum) / n;

    newRanks.fill((1 - DAMPING) / n + danglingContribution);

    for (let i = 0; i < n; i++) {
      const links = outLinks.get(i);
      if (!links || links.length === 0) {
        continue;
      }

      const share = ranks[i]! / links.length;
      for (const target of links) {
        newRanks[target] = newRanks[target]! + DAMPING * share;
      }
    }

    let diff = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs(newRanks[i]! - ranks[i]!);
    }

    [ranks, newRanks] = [newRanks, ranks];

    if (diff < CONVERGENCE_THRESHOLD) {
      log.debug(`PageRank converged after ${iter + 1} iterations`);
      break;
    }
  }

  const result = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const symbolId = symbolIds[i]!;
    result.set(symbolId, ranks[i]!);
  }

  return result;
}

export function updateCentralityScores(db: Database.Database): void {
  const symbolsQ = symbolQueries(db);
  const ranks = computePageRank(db);

  log.info(`updating centrality for ${ranks.size} symbols`);

  for (const [symbolId, rank] of ranks) {
    symbolsQ.updateCentrality(symbolId, rank);
  }
}

export function runPageRankInBackground(dbPath: string): void {
  const worker = new Worker(
    PAGERANK_WORKER,
    USE_TSX_WORKER_LOADER
      ? { workerData: { dbPath }, execArgv: ["--import", "tsx"] }
      : { workerData: { dbPath } }
  );

  worker.once("error", (err) => {
    log.error("background PageRank worker error", err);
  });

  worker.once("exit", (code) => {
    if (code === 0) {
      log.info("background PageRank completed");
    } else {
      log.warn(`background PageRank worker exited with code ${code}`);
    }
  });
}

export function getDepthForBudget(tokenBudget: number): number {
  if (tokenBudget < 2000) return 3;
  if (tokenBudget < 5000) return 4;
  if (tokenBudget < 10000) return 5;
  return 6;
}
