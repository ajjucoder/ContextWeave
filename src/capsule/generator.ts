import type Database from "better-sqlite3";
import type {
  CapsuleOutput,
  CapsuleMode,
  ScoredNode,
  CapsuleMetadata,
  CompressionLevel,
  ObservationRecord,
} from "../core/types.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { fileQueries } from "../db/queries/files.js";
import { edgeQueries } from "../db/queries/edges.js";
import { fuzzyMatch } from "../utils/fuzzy.js";
import { countTokens } from "../utils/tokens.js";
import { scoreNode, assignCompressionLevel } from "./scorer.js";
import { renderSymbol } from "./compressor.js";
import { packNodes } from "./packer.js";
import { formatCapsule } from "./formatter.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("generator");

interface CapsuleParams {
  query: string;
  tokenBudget?: number;
  mode?: CapsuleMode;
  sessionId?: string;
}

function getBfsDepth(budget: number): number {
  if (budget < 2000) return 3;
  if (budget < 5000) return 4;
  if (budget < 10000) return 5;
  return 6;
}

export function generateCapsule(db: Database.Database, params: CapsuleParams): CapsuleOutput {
  const tokenBudget = params.tokenBudget ?? 4000;
  const mode = params.mode ?? "feature";
  const { query } = params;

  logger.info("generating capsule", { query, tokenBudget, mode });

  const symbols = symbolQueries(db);
  const files = fileQueries(db);
  const edges = edgeQueries(db);

  // Phase 1: Pivot Resolution
  const allNames = symbols.getAllNames();
  const allFiles = files.getAll();
  const filePaths = allFiles.map((f) => f.path);

  const queryTerms = query.trim().split(/\s+/);
  const pivotSymbolIds = new Set<number>();

  for (const term of queryTerms) {
    const nameMatches = fuzzyMatch(term, allNames, 0.5);
    for (const match of nameMatches.slice(0, 5)) {
      const matched = symbols.getByName(match.name);
      for (const s of matched) pivotSymbolIds.add(s.id);
    }

    const pathMatches = fuzzyMatch(term, filePaths, 0.4);
    for (const match of pathMatches.slice(0, 3)) {
      const file = allFiles.find((f) => f.path === match.name);
      if (!file) continue;
      const fileSymbols = symbols.getByFileId(file.id);
      for (const s of fileSymbols) pivotSymbolIds.add(s.id);
    }
  }

  logger.debug("pivot symbols found", { count: pivotSymbolIds.size });

  // Phase 2: BFS Traversal
  const maxDepth = getBfsDepth(tokenBudget);
  const visited = new Map<number, number>(); // symbolId → distance

  const queue: Array<{ id: number; depth: number }> = [];
  for (const id of pivotSymbolIds) {
    queue.push({ id, depth: 0 });
    visited.set(id, 0);
  }

  let qi = 0;
  while (qi < queue.length) {
    const { id, depth } = queue[qi++]!;
    if (depth >= maxDepth) continue;

    const outEdges = edges.getBySource(id);
    const inEdges = edges.getByTarget(id);

    for (const edge of [...outEdges, ...inEdges]) {
      const neighborId =
        edge.sourceSymbolId === id ? edge.targetSymbolId : edge.sourceSymbolId;
      if (!visited.has(neighborId)) {
        visited.set(neighborId, depth + 1);
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }
  }

  logger.debug("bfs traversal complete", { nodesVisited: visited.size });

  // Phase 3: Node Scoring
  const fileCache = new Map<number, ReturnType<typeof files.getById>>();
  const getFile = (fileId: number) => {
    if (!fileCache.has(fileId)) fileCache.set(fileId, files.getById(fileId));
    return fileCache.get(fileId);
  };

  const scored: Array<{ symbol: ReturnType<typeof symbols.getById>; file: ReturnType<typeof files.getById>; score: number; distance: number }> = [];

  for (const [symbolId, distance] of visited) {
    const symbol = symbols.getById(symbolId);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;

    const score = scoreNode({
      distance,
      centrality: symbol.centrality,
      lastSeen: symbol.lastSeen,
      observationCount: 0,
      isExported: symbol.isExported,
      mode,
    });

    scored.push({ symbol, file, score, distance });
  }

  // Phase 4: Compression Assignment
  const maxScore = scored.reduce((m, n) => Math.max(m, n.score), 0);

  const scoredNodes: ScoredNode[] = scored.map(({ symbol, file, score, distance }) => {
    const compressionLevel = assignCompressionLevel(score, distance, maxScore);
    const rendered = renderSymbol(symbol!, file!, compressionLevel);
    const tokenCount = countTokens(rendered);
    return {
      symbol: symbol!,
      file: file!,
      score,
      distance,
      compressionLevel,
      rendered,
      tokenCount,
    };
  });

  // Phase 5: Render + Pack
  const observationReserve = 0.2;
  const { packed, tokensUsed } = packNodes(scoredNodes, tokenBudget * (1 - observationReserve));

  // Phase 6: Observation Append (stub)
  const observations: ObservationRecord[] = [];

  // Phase 7: Format + Return
  const compressionBreakdown: Record<CompressionLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const node of packed) {
    compressionBreakdown[node.compressionLevel]++;
  }

  const uniqueFiles = new Set(packed.map((n) => n.file.path));

  const metadata: CapsuleMetadata = {
    query,
    mode,
    tokenBudget,
    tokensUsed,
    symbolCount: packed.length,
    fileCount: uniqueFiles.size,
    compressionBreakdown,
    observationCount: observations.length,
    generatedAt: Date.now(),
  };

  const content = formatCapsule(packed, observations, metadata);

  logger.info("capsule generated", {
    symbolCount: packed.length,
    fileCount: uniqueFiles.size,
    tokensUsed,
  });

  return { content, metadata };
}
