import type Database from "better-sqlite3";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { createLogger } from "../utils/logger.js";

type Statement = Database.Statement;

const log = createLogger("graph");
const WORKER_DIR = dirname(fileURLToPath(import.meta.url));
const USE_SOURCE_WORKER_SCRIPT = WORKER_DIR.includes(`${sep}src${sep}`);
const PAGERANK_WORKER = join(WORKER_DIR, USE_SOURCE_WORKER_SCRIPT ? "pagerank-worker-source.js" : "pagerank-worker.js");
const activePageRankWorkers = new Map<string, Worker>();
const pendingPageRankRuns = new Set<string>();

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

function collectOutgoingSubgraph(
  db: Database.Database,
  pivotIds: number[],
  maxDepth = Number.POSITIVE_INFINITY
): {
  reachable: Set<number>;
  distances: Map<number, number>;
  outgoing: Map<number, number[]>;
} {
  const edges = edgeQueries(db);
  const reachable = new Set<number>();
  const distances = new Map<number, number>();
  const outgoing = new Map<number, number[]>();
  const queue: Array<{ symbolId: number; distance: number }> = [];

  for (const pivotId of pivotIds) {
    if (reachable.has(pivotId)) continue;
    reachable.add(pivotId);
    distances.set(pivotId, 0);
    queue.push({ symbolId: pivotId, distance: 0 });
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    if (current.distance >= maxDepth) continue;

    const nextIds = edges.getBySource(current.symbolId).map((edge) => edge.targetSymbolId);
    outgoing.set(current.symbolId, nextIds);

    for (const nextId of nextIds) {
      if (reachable.has(nextId)) continue;
      reachable.add(nextId);
      distances.set(nextId, current.distance + 1);
      queue.push({ symbolId: nextId, distance: current.distance + 1 });
    }
  }

  for (const symbolId of reachable) {
    if (!outgoing.has(symbolId)) {
      outgoing.set(symbolId, []);
    }
  }

  return { reachable, distances, outgoing };
}

function compareTopologicalQueue(
  left: number,
  right: number,
  distances: Map<number, number>
): number {
  const distanceDelta = (distances.get(right) ?? 0) - (distances.get(left) ?? 0);
  if (distanceDelta !== 0) return distanceDelta;
  return left - right;
}

export function topologicalSort(
  db: Database.Database,
  pivotIds: number[],
  maxDepth = Number.POSITIVE_INFINITY
): number[] {
  if (pivotIds.length === 0) return [];

  const { reachable, distances, outgoing } = collectOutgoingSubgraph(db, pivotIds, maxDepth);
  if (reachable.size === 0) return [];

  const dependencyOutgoing = new Map<number, number[]>();
  const indegree = new Map<number, number>();

  for (const symbolId of reachable) {
    dependencyOutgoing.set(symbolId, []);
    indegree.set(symbolId, 0);
  }

  for (const [sourceId, targetIds] of outgoing) {
    for (const targetId of targetIds) {
      if (!reachable.has(targetId)) continue;
      dependencyOutgoing.get(targetId)!.push(sourceId);
      indegree.set(sourceId, (indegree.get(sourceId) ?? 0) + 1);
    }
  }

  const queue = [...reachable]
    .filter((symbolId) => (indegree.get(symbolId) ?? 0) === 0)
    .sort((left, right) => compareTopologicalQueue(left, right, distances));
  const ordered: number[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    ordered.push(current);

    for (const dependentId of dependencyOutgoing.get(current) ?? []) {
      const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(dependentId);
        queue.sort((left, right) => compareTopologicalQueue(left, right, distances));
      }
    }
  }

  if (ordered.length < reachable.size) {
    const remaining = [...reachable]
      .filter((symbolId) => !ordered.includes(symbolId))
      .sort((left, right) => compareTopologicalQueue(left, right, distances));
    ordered.push(...remaining);
  }

  return ordered;
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
const MAX_BETWEENNESS_SYMBOLS = 100_000;

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

export function computeBetweennessCentrality(db: Database.Database): Map<number, number> {
  const symbols = symbolQueries(db);
  const symbolIds = symbols.getAllIds();

  if (symbolIds.length === 0) return new Map();

  const n = symbolIds.length;
  const idToIndex = new Map(symbolIds.map((id, i) => [id, i]));
  const { targets, offsets } = buildCompactAdjacency(db, idToIndex, n);
  const betweenness = new Float64Array(n);

  for (let source = 0; source < n; source++) {
    const stack: number[] = [];
    const predecessors = new Map<number, number[]>();
    const sigma = new Float64Array(n);
    const delta = new Float64Array(n);
    const distance = new Int32Array(n).fill(-1);
    const queue: number[] = [source];

    sigma[source] = 1;
    distance[source] = 0;

    let head = 0;
    while (head < queue.length) {
      const vertex = queue[head++]!;
      stack.push(vertex);

      const start = offsets[vertex]!;
      const end = offsets[vertex + 1]!;
      for (let edgeIndex = start; edgeIndex < end; edgeIndex++) {
        const neighbor = targets[edgeIndex]!;
        const neighborDistance = distance[neighbor] ?? -1;
        const vertexDistance = distance[vertex] ?? 0;
        if (neighborDistance < 0) {
          distance[neighbor] = (distance[vertex] ?? 0) + 1;
          queue.push(neighbor);
        }
        if ((distance[neighbor] ?? -1) === vertexDistance + 1) {
          sigma[neighbor] = (sigma[neighbor] ?? 0) + (sigma[vertex] ?? 0);
          const prior = predecessors.get(neighbor);
          if (prior) prior.push(vertex);
          else predecessors.set(neighbor, [vertex]);
        }
      }
    }

    while (stack.length > 0) {
      const vertex = stack.pop()!;
      const prior = predecessors.get(vertex) ?? [];
      for (const predecessor of prior) {
        const sigmaVertex = sigma[vertex] ?? 0;
        if (sigmaVertex === 0) continue;
        delta[predecessor] = (delta[predecessor] ?? 0) + ((sigma[predecessor] ?? 0) / sigmaVertex) * (1 + (delta[vertex] ?? 0));
      }
      if (vertex !== source) {
        betweenness[vertex] = (betweenness[vertex] ?? 0) + (delta[vertex] ?? 0);
      }
    }
  }

  const result = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    result.set(symbolIds[i]!, betweenness[i]!);
  }
  return result;
}

export function findStronglyConnectedComponents(db: Database.Database): number[][] {
  const symbols = symbolQueries(db);
  const symbolIds = symbols.getAllIds();

  if (symbolIds.length === 0) return [];

  const n = symbolIds.length;
  const idToIndex = new Map(symbolIds.map((id, index) => [id, index]));
  const { targets, offsets } = buildCompactAdjacency(db, idToIndex, n);
  const indexByVertex = new Int32Array(n).fill(-1);
  const lowLink = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const components: number[][] = [];
  let currentIndex = 0;

  const strongConnect = (vertex: number) => {
    indexByVertex[vertex] = currentIndex;
    lowLink[vertex] = currentIndex;
    currentIndex += 1;
    stack.push(vertex);
    onStack[vertex] = 1;

    const start = offsets[vertex]!;
    const end = offsets[vertex + 1]!;
    for (let edgeIndex = start; edgeIndex < end; edgeIndex++) {
      const neighbor = targets[edgeIndex]!;
      if (indexByVertex[neighbor] === -1) {
        strongConnect(neighbor);
        lowLink[vertex] = Math.min(lowLink[vertex]!, lowLink[neighbor]!);
      } else if (onStack[neighbor] === 1) {
        lowLink[vertex] = Math.min(lowLink[vertex]!, indexByVertex[neighbor]!);
      }
    }

    if (lowLink[vertex] !== indexByVertex[vertex]) return;

    const component: number[] = [];
    let stackedVertex = -1;
    while (stackedVertex !== vertex) {
      stackedVertex = stack.pop()!;
      onStack[stackedVertex] = 0;
      component.push(symbolIds[stackedVertex]!);
    }
    components.push(component);
  };

  for (let vertex = 0; vertex < n; vertex++) {
    if (indexByVertex[vertex] === -1) {
      strongConnect(vertex);
    }
  }

  return components;
}

export function countCircularDependencyClusters(db: Database.Database): number {
  const symbols = symbolQueries(db);
  const symbolIds = symbols.getAllIds();

  if (symbolIds.length === 0) return 0;

  const idToIndex = new Map(symbolIds.map((id, index) => [id, index]));
  const { targets, offsets } = buildCompactAdjacency(db, idToIndex, symbolIds.length);

  let count = 0;
  for (const component of findStronglyConnectedComponents(db)) {
    if (component.length > 1) {
      count += 1;
      continue;
    }

    const symbolId = component[0];
    if (symbolId === undefined) continue;

    const vertex = idToIndex.get(symbolId);
    if (vertex === undefined) continue;

    const start = offsets[vertex]!;
    const end = offsets[vertex + 1]!;
    for (let edgeIndex = start; edgeIndex < end; edgeIndex++) {
      if (targets[edgeIndex] === vertex) {
        count += 1;
        break;
      }
    }
  }

  return count;
}

const CENTRALITY_UPDATE_BATCH_SIZE = 5000;

export function updateCentralityScores(db: Database.Database): void {
  const symbolsQ = symbolQueries(db);
  const ranks = computePageRank(db);
  const shouldComputeBetweenness = ranks.size <= MAX_BETWEENNESS_SYMBOLS;
  const betweenness = shouldComputeBetweenness ? computeBetweennessCentrality(db) : null;

  log.info(`updating centrality metrics for ${ranks.size} symbols`);
  if (!shouldComputeBetweenness) {
    log.info(
      `skipping betweenness centrality for ${ranks.size} symbols (limit ${MAX_BETWEENNESS_SYMBOLS})`
    );
  }

  if (ranks.size <= CENTRALITY_UPDATE_BATCH_SIZE) {
    const applyUpdates = db.transaction(() => {
      if (!shouldComputeBetweenness) {
        db.prepare("UPDATE symbols SET betweenness = 0").run();
      }
      for (const [symbolId, rank] of ranks) {
        symbolsQ.updateCentrality(symbolId, rank);
        symbolsQ.updateBetweenness(symbolId, betweenness?.get(symbolId) ?? 0);
      }
    });
    applyUpdates();
    return;
  }

  if (!shouldComputeBetweenness) {
    db.prepare("UPDATE symbols SET betweenness = 0").run();
  }

  const entries = [...ranks.entries()];
  for (let i = 0; i < entries.length; i += CENTRALITY_UPDATE_BATCH_SIZE) {
    const batch = entries.slice(i, i + CENTRALITY_UPDATE_BATCH_SIZE);
    const applyBatch = db.transaction(() => {
      for (const [symbolId, rank] of batch) {
        symbolsQ.updateCentrality(symbolId, rank);
        symbolsQ.updateBetweenness(symbolId, betweenness?.get(symbolId) ?? 0);
      }
    });
    applyBatch();
  }
}

export function runPageRankInBackground(dbPath: string): void {
  if (activePageRankWorkers.has(dbPath)) {
    pendingPageRankRuns.add(dbPath);
    log.debug("background PageRank already running; scheduling rerun", { dbPath });
    return;
  }

  const worker = new Worker(PAGERANK_WORKER, { workerData: { dbPath } });
  activePageRankWorkers.set(dbPath, worker);
  worker.unref?.();

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    activePageRankWorkers.delete(dbPath);
    if (pendingPageRankRuns.delete(dbPath)) {
      queueMicrotask(() => runPageRankInBackground(dbPath));
    }
  };

  worker.once("error", (err) => {
    log.error("background PageRank worker error", err);
    finish();
  });

  worker.once("exit", (code) => {
    if (code === 0) {
      log.info("background PageRank completed");
    } else {
      log.warn(`background PageRank worker exited with code ${code}`);
    }
    finish();
  });
}

export function getDepthForBudget(tokenBudget: number): number {
  if (tokenBudget < 2000) return 3;
  if (tokenBudget < 5000) return 4;
  if (tokenBudget < 10000) return 5;
  return 6;
}
