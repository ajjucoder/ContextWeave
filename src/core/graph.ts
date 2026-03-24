import type Database from "better-sqlite3";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { createLogger } from "../utils/logger.js";

type Statement = Database.Statement;

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

  for (const edge of edgeQueries(db).iterateAll()) {
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

const lazyBfsStmtCache = new WeakMap<Database.Database, { out: ReturnType<Database.Database["prepare"]>; inc: ReturnType<Database.Database["prepare"]> }>();

function getLazyBfsStmts(db: Database.Database) {
  const cached = lazyBfsStmtCache.get(db);
  if (cached) return cached;
  const stmts = {
    out: db.prepare("SELECT target_symbol_id FROM edges WHERE source_symbol_id = ?"),
    inc: db.prepare("SELECT source_symbol_id FROM edges WHERE target_symbol_id = ?"),
  };
  lazyBfsStmtCache.set(db, stmts);
  return stmts;
}

export function lazyBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number
): BfsNode[] {
  const { out: getOutgoing, inc: getIncoming } = getLazyBfsStmts(db);

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

const scopedBfsStmtCache = new WeakMap<Database.Database, { out: ReturnType<Database.Database["prepare"]>; inc: ReturnType<Database.Database["prepare"]> }>();

function getScopedBfsStmts(db: Database.Database) {
  const cached = scopedBfsStmtCache.get(db);
  if (cached) return cached;
  const stmts = {
    out: db.prepare(
      "SELECT e.target_symbol_id, f.path FROM edges e JOIN symbols s ON s.id = e.target_symbol_id JOIN files f ON f.id = s.file_id WHERE e.source_symbol_id = ?"
    ),
    inc: db.prepare(
      "SELECT e.source_symbol_id, f.path FROM edges e JOIN symbols s ON s.id = e.source_symbol_id JOIN files f ON f.id = s.file_id WHERE e.target_symbol_id = ?"
    ),
  };
  scopedBfsStmtCache.set(db, stmts);
  return stmts;
}

export function scopedLazyBfsTraversal(
  db: Database.Database,
  pivotIds: number[],
  maxDepth: number,
  scopeDirs: string[] | null
): BfsNode[] {
  const { out: getOutgoing, inc: getIncoming } = getScopedBfsStmts(db);

  const isInScope = (filePath: string): boolean => {
    if (!scopeDirs || scopeDirs.length === 0) return true;
    return scopeDirs.some((dir) => filePath.startsWith(`${dir}/`) || filePath.startsWith(`${dir}\\`));
  };

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

    const outgoing = (getOutgoing.all(current.symbolId) as Array<{ target_symbol_id: number; path: string }>)
      .filter((row) => isInScope(row.path))
      .map((row) => row.target_symbol_id);

    const incoming = (getIncoming.all(current.symbolId) as Array<{ source_symbol_id: number; path: string }>)
      .filter((row) => isInScope(row.path))
      .map((row) => row.source_symbol_id);

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

const degreeStmtCache = new WeakMap<Database.Database, { out: Database.Statement; inc: Database.Statement }>();
const batchDegreeStmtCache = new WeakMap<
  Database.Database,
  {
    out: Map<number, Statement>;
    inc: Map<number, Statement>;
  }
>();

export function getSymbolDegree(db: Database.Database, symbolId: number): number {
  let stmts = degreeStmtCache.get(db);
  if (!stmts) {
    stmts = {
      out: db.prepare("SELECT COUNT(*) as c FROM edges WHERE source_symbol_id = ?"),
      inc: db.prepare("SELECT COUNT(*) as c FROM edges WHERE target_symbol_id = ?"),
    };
    degreeStmtCache.set(db, stmts);
  }
  const out = stmts.out.get(symbolId) as { c: number };
  const inc = stmts.inc.get(symbolId) as { c: number };
  return out.c + inc.c;
}

function getBatchDegreeStatements(
  db: Database.Database,
  chunkSize: number
): {
  out: Statement;
  inc: Statement;
} {
  let cache = batchDegreeStmtCache.get(db);
  if (!cache) {
    cache = { out: new Map(), inc: new Map() };
    batchDegreeStmtCache.set(db, cache);
  }

  let outStmt = cache.out.get(chunkSize);
  let incStmt = cache.inc.get(chunkSize);
  if (!outStmt || !incStmt) {
    const placeholders = Array.from({ length: chunkSize }, () => "?").join(", ");
    outStmt = db.prepare(
      `SELECT source_symbol_id as id, COUNT(*) as c FROM edges WHERE source_symbol_id IN (${placeholders}) GROUP BY source_symbol_id`
    );
    incStmt = db.prepare(
      `SELECT target_symbol_id as id, COUNT(*) as c FROM edges WHERE target_symbol_id IN (${placeholders}) GROUP BY target_symbol_id`
    );
    cache.out.set(chunkSize, outStmt);
    cache.inc.set(chunkSize, incStmt);
  }

  return { out: outStmt, inc: incStmt };
}

export function getBatchSymbolDegrees(db: Database.Database, symbolIds: number[]): Map<number, number> {
  if (symbolIds.length === 0) return new Map();

  const degrees = new Map<number, number>();
  for (const id of symbolIds) {
    degrees.set(id, 0);
  }

  const CHUNK_SIZE = 400;
  for (let i = 0; i < symbolIds.length; i += CHUNK_SIZE) {
    const chunk = symbolIds.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const { out: outStmt, inc: incStmt } = getBatchDegreeStatements(db, chunk.length);

    for (const row of outStmt.all(...chunk) as Array<{ id: number; c: number }>) {
      degrees.set(row.id, (degrees.get(row.id) ?? 0) + row.c);
    }
    for (const row of incStmt.all(...chunk) as Array<{ id: number; c: number }>) {
      degrees.set(row.id, (degrees.get(row.id) ?? 0) + row.c);
    }
  }

  return degrees;
}

const DAMPING = 0.85;
const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 1e-6;

interface CompactAdjacency {
  targets: Int32Array;
  offsets: Int32Array;
  outDegree: Int32Array;
}

function buildCompactAdjacency(
  db: Database.Database,
  idToIndex: Map<number, number>,
  n: number
): CompactAdjacency {
  const edges = edgeQueries(db);
  const tempLists: number[][] = new Array(n);
  for (let i = 0; i < n; i++) tempLists[i] = [];

  for (const edge of edges.iterateAll()) {
    const sourceIdx = idToIndex.get(edge.sourceSymbolId);
    const targetIdx = idToIndex.get(edge.targetSymbolId);
    if (sourceIdx === undefined || targetIdx === undefined) continue;
    tempLists[sourceIdx]!.push(targetIdx);
  }

  const outDegree = new Int32Array(n);
  const offsets = new Int32Array(n + 1);
  let totalEdges = 0;
  for (let i = 0; i < n; i++) {
    outDegree[i] = tempLists[i]!.length;
    offsets[i] = totalEdges;
    totalEdges += outDegree[i]!;
  }
  offsets[n] = totalEdges;

  const targets = new Int32Array(totalEdges);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    for (const t of tempLists[i]!) {
      targets[pos++] = t;
    }
  }

  return { targets, offsets, outDegree };
}

export function computePageRank(db: Database.Database): Map<number, number> {
  const symbols = symbolQueries(db);

  const symbolIds = symbols.getAllIds();

  if (symbolIds.length === 0) return new Map();

  const n = symbolIds.length;
  const idToIndex = new Map(symbolIds.map((id, i) => [id, i]));

  const { targets, offsets, outDegree } = buildCompactAdjacency(db, idToIndex, n);

  let ranks = new Float64Array(n).fill(1 / n);
  let newRanks = new Float64Array(n);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      if (outDegree[i] === 0) {
        danglingSum += ranks[i]!;
      }
    }
    const danglingContribution = (DAMPING * danglingSum) / n;

    newRanks.fill((1 - DAMPING) / n + danglingContribution);

    for (let i = 0; i < n; i++) {
      const deg = outDegree[i]!;
      if (deg === 0) continue;

      const share = ranks[i]! / deg;
      const start = offsets[i]!;
      const end = offsets[i + 1]!;
      for (let j = start; j < end; j++) {
        const target = targets[j]!;
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

const CENTRALITY_UPDATE_BATCH_SIZE = 5000;

export function updateCentralityScores(db: Database.Database): void {
  const symbolsQ = symbolQueries(db);
  const ranks = computePageRank(db);

  log.info(`updating centrality for ${ranks.size} symbols`);

  if (ranks.size <= CENTRALITY_UPDATE_BATCH_SIZE) {
    const applyUpdates = db.transaction(() => {
      for (const [symbolId, rank] of ranks) {
        symbolsQ.updateCentrality(symbolId, rank);
      }
    });
    applyUpdates();
    return;
  }

  const entries = [...ranks.entries()];
  for (let i = 0; i < entries.length; i += CENTRALITY_UPDATE_BATCH_SIZE) {
    const batch = entries.slice(i, i + CENTRALITY_UPDATE_BATCH_SIZE);
    const applyBatch = db.transaction(() => {
      for (const [symbolId, rank] of batch) {
        symbolsQ.updateCentrality(symbolId, rank);
      }
    });
    applyBatch();
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
