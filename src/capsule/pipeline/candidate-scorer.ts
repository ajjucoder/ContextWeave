/**
 * Candidate scoring and selection stage for capsule generation.
 */
import { dirname } from "node:path";
import type Database from "better-sqlite3";
import type { EdgeSummary } from "../compressor.js";
import { renderSymbol } from "../compressor.js";
import { scoreNode, assignCompressionLevel } from "../scorer.js";
import { checkChainCoverage, type LayerCoverage } from "../chain-coverage.js";
import { PAGE_ENTRY_PATH_RE, UI_COMPONENT_PATH_RE, isUiLikePath } from "../signals.js";
import { getDirectoryWeight } from "../../utils/directory-weights.js";
import { estimateTokens } from "../../utils/tokens.js";
import { getExpectedLayers, getLaneWeightForPath, getRetrievalLanes } from "../../core/repo-profiler.js";
import { getFileClusterId } from "../../core/clusters.js";
import { embeddingBufferToFloat32 } from "../../core/vector-quantization.js";
import { isTestFile, getLexicalScore, getCommonDisplayRoot, toDisplayPath } from "../generator-helpers.js";
import type { FileRecord, LightSymbolRecord, ScoredNode } from "../../core/types.js";
import type { CapsuleContext, GraphExpansion, PivotResolution, RankedCandidate } from "./types.js";
import {
  getRuntimeKindWeight,
  hasActionSignal,
  tokenizeCoverageTerms,
} from "./pivot-resolver.js";

function getVisibilityPenalty(
  visibility: LightSymbolRecord["visibility"],
  sameFileAsPivot: boolean,
  distance: number
): number {
  if (sameFileAsPivot || distance <= 0) return 1;
  if (visibility === "private") return 0.15;
  if (visibility === "protected") return 0.45;
  if (visibility === "internal") return 0.65;
  return 1;
}

function visibilityRank(visibility?: LightSymbolRecord["visibility"]): number {
  if (visibility === "public" || visibility === undefined) return 0;
  if (visibility === "internal") return 1;
  if (visibility === "protected") return 2;
  return 3;
}

type Statement = Database.Statement;

const EDGE_BATCH_CHUNK_SIZE = 400;
const outgoingEdgeBatchStmtCache = new WeakMap<
  Database.Database,
  Map<number, Statement>
>();
const embeddingStmtCache = new WeakMap<
  Database.Database,
  Database.Statement<[number], { file_id: number; start_line: number; end_line: number; embedding: Buffer }>
>();

export interface CandidateScoringResult {
  candidates: RankedCandidate[];
  ranked: RankedCandidate[];
  selected: RankedCandidate[];
  scoredNodes: ScoredNode[];
  clusterBySymbolId: Map<number, number>;
  layerCoverages: LayerCoverage[];
}

interface CandidateEmbeddingRow {
  file_id: number;
  start_line: number;
  end_line: number;
  embedding: Buffer;
}

interface PruneUiNoiseOptions {
  intent: PivotResolution["intent"];
  queryUiFocused: boolean;
}

interface EnsureBroadFileSpreadOptions {
  intent: PivotResolution["intent"];
  tokenBudget: number;
  queryUiFocused: boolean;
  ranked: RankedCandidate[];
  visited: Map<number, number>;
  getFileSymbols(fileId: number): LightSymbolRecord[];
  files?: Iterable<FileRecord>;
  pivotQueryTerms: string[];
}

function getOutgoingEdgeBatchStatement(
  db: Database.Database,
  chunkSize: number
): Statement {
  let cache = outgoingEdgeBatchStmtCache.get(db);
  if (!cache) {
    cache = new Map();
    outgoingEdgeBatchStmtCache.set(db, cache);
  }

  let stmt = cache.get(chunkSize);
  if (!stmt) {
    const placeholders = Array.from({ length: chunkSize }, () => "?").join(",");
    stmt = db.prepare(
      `SELECT e.source_symbol_id, s.name AS target_name, e.kind
       FROM edges e
       JOIN symbols s ON s.id = e.target_symbol_id
       WHERE e.source_symbol_id IN (${placeholders})
         AND e.kind IN ('call', 'import')`
    );
    cache.set(chunkSize, stmt);
  }

  return stmt;
}

function getCandidateEmbeddingStatement(
  db: Database.Database
): Database.Statement<[number], CandidateEmbeddingRow> {
  const cached = embeddingStmtCache.get(db);
  if (cached) {
    return cached;
  }

  const stmt = db.prepare<[number], CandidateEmbeddingRow>(`
    SELECT file_id, start_line, end_line, embedding
    FROM chunk_embeddings
    WHERE file_id = ?
    ORDER BY start_line ASC, end_line ASC
  `);
  embeddingStmtCache.set(db, stmt);
  return stmt;
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  const cosine = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return Math.max(0, Math.min(1, cosine));
}

function scoreOverlappingEmbedding(
  queryEmbedding: Float32Array,
  candidate: RankedCandidate,
  embeddingsByFileId: Map<number, CandidateEmbeddingRow[]>
): number {
  const embeddings = embeddingsByFileId.get(candidate.file.id) ?? [];
  let bestScore = 0;

  for (const row of embeddings) {
    const overlapsSymbol =
      row.start_line <= candidate.symbol.endLine &&
      row.end_line >= candidate.symbol.startLine;
    if (!overlapsSymbol) continue;

    const cosine = cosineSimilarity(
      queryEmbedding,
      embeddingBufferToFloat32(row.embedding, queryEmbedding.length)
    );
    if (cosine > bestScore) {
      bestScore = cosine;
    }
  }

  return bestScore;
}

function applyHybridScoreBlend(
  context: CapsuleContext,
  pivot: PivotResolution,
  candidates: RankedCandidate[]
): RankedCandidate[] {
  const queryEmbedding = context.params.queryEmbedding;
  if (!queryEmbedding || candidates.length === 0) {
    return candidates;
  }

  const fileIds = [...new Set(candidates.map((candidate) => candidate.file.id))];
  if (fileIds.length === 0) {
    return candidates;
  }

  const embeddingsByFileId = new Map<number, CandidateEmbeddingRow[]>();
  const getEmbeddings = getCandidateEmbeddingStatement(context.db);
  for (const fileId of fileIds) {
    const rows = getEmbeddings.all(fileId);
    if (rows.length > 0) {
      embeddingsByFileId.set(fileId, rows);
    }
  }

  if (embeddingsByFileId.size === 0) {
    return candidates;
  }

  const maxBaseScore = candidates.reduce((max, candidate) => Math.max(max, candidate.score), 0);
  if (maxBaseScore <= 0) {
    return candidates;
  }

  const bm25Weight = pivot.intent === "narrow" ? 0.8 : 0.6;
  const cosineWeight = pivot.intent === "narrow" ? 0.2 : 0.4;

  return candidates.map((candidate) => {
    const cosineScore = scoreOverlappingEmbedding(queryEmbedding, candidate, embeddingsByFileId);
    if (cosineScore <= 0) {
      return candidate;
    }

    const normalizedBaseScore = candidate.score / maxBaseScore;
    const blendedScore = bm25Weight * normalizedBaseScore + cosineWeight * cosineScore;
    return {
      ...candidate,
      score: blendedScore * maxBaseScore,
    };
  });
}

export function pruneUiNoise(selectedCandidates: RankedCandidate[], options: PruneUiNoiseOptions): RankedCandidate[] {
  if (
    options.queryUiFocused ||
    !(options.intent === "broad" || options.intent === "task" || options.intent === "debug") ||
    selectedCandidates.length === 0
  ) {
    return selectedCandidates;
  }

  const nonUiCount = selectedCandidates.filter((candidate) => !isUiLikePath(candidate.file.path)).length;
  if (nonUiCount < 3) {
    return selectedCandidates;
  }

  return selectedCandidates.filter((candidate) =>
    !isUiLikePath(candidate.file.path) || hasActionSignal(candidate.symbol.name, candidate.symbol.signature)
  );
}

export function ensureBroadFileSpread(
  selectedCandidates: RankedCandidate[],
  options: EnsureBroadFileSpreadOptions
): RankedCandidate[] {
  if (options.intent !== "broad" || options.tokenBudget < 4000 || selectedCandidates.length === 0) {
    return selectedCandidates;
  }

  const selectedIds = new Set<number>(selectedCandidates.map((candidate) => candidate.symbol.id));
  const selectedFileIds = new Set<number>(selectedCandidates.map((candidate) => candidate.file.id));
  if (selectedFileIds.size >= 3) {
    return selectedCandidates;
  }

  const augmented = [...selectedCandidates];
  const maybeAddCandidate = (candidate: RankedCandidate): boolean => {
    if (selectedIds.has(candidate.symbol.id) || selectedFileIds.has(candidate.file.id)) {
      return false;
    }
    if (!options.queryUiFocused && isUiLikePath(candidate.file.path) && !hasActionSignal(candidate.symbol.name, candidate.symbol.signature)) {
      return false;
    }
    augmented.push(candidate);
    selectedIds.add(candidate.symbol.id);
    selectedFileIds.add(candidate.file.id);
    return selectedFileIds.size >= 3;
  };

  for (const candidate of options.ranked) {
    const relevant = candidate.lexicalScore > 0;
    if (!relevant) continue;
    if (maybeAddCandidate(candidate)) return augmented;
  }

  for (const candidate of options.ranked) {
    if (maybeAddCandidate(candidate)) return augmented;
  }

  const selectedDirs = new Set(augmented.map((candidate) => dirname(candidate.file.path)));
  for (const file of options.files ?? []) {
    if (selectedFileIds.has(file.id) || !selectedDirs.has(dirname(file.path))) continue;
    if (!options.queryUiFocused && isUiLikePath(file.path)) continue;

    const bestSymbol = options.getFileSymbols(file.id)
      .map((symbol) => ({
        symbol,
        lexicalScore: getLexicalScore(
          symbol,
          file,
          options.pivotQueryTerms,
          new Set(options.pivotQueryTerms.map((term) => term.toLowerCase()))
        ),
      }))
      .sort((a, b) => {
        const visibilityDiff = visibilityRank(a.symbol.visibility) - visibilityRank(b.symbol.visibility);
        if (visibilityDiff !== 0) return visibilityDiff;
        if (a.symbol.isExported !== b.symbol.isExported) return a.symbol.isExported ? -1 : 1;
        if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore;
        return b.symbol.centrality - a.symbol.centrality;
      })[0];

    if (!bestSymbol) continue;
    if (!options.queryUiFocused && isUiLikePath(file.path) && !hasActionSignal(bestSymbol.symbol.name, bestSymbol.symbol.signature)) {
      continue;
    }
    if (options.visited.has(bestSymbol.symbol.id)) continue;

    augmented.push({
      symbol: bestSymbol.symbol,
      file,
      score: bestSymbol.lexicalScore * 5 + 0.25,
      distance: 2,
      traversalBoost: 1,
      isPivot: false,
      lexicalScore: bestSymbol.lexicalScore,
      degree: 0,
    });
    selectedIds.add(bestSymbol.symbol.id);
    selectedFileIds.add(file.id);
    if (selectedFileIds.size >= 3) return augmented;
  }

  return augmented;
}

export function batchFetchOutgoingEdges(context: CapsuleContext, symbolIds: number[]): Map<number, EdgeSummary[]> {
  const result = new Map<number, EdgeSummary[]>();
  if (symbolIds.length === 0) return result;

  for (let i = 0; i < symbolIds.length; i += EDGE_BATCH_CHUNK_SIZE) {
    const chunk = symbolIds.slice(i, i + EDGE_BATCH_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const rows = getOutgoingEdgeBatchStatement(context.db, chunk.length).all(...chunk) as Array<{
      source_symbol_id: number;
      target_name: string;
      kind: string;
    }>;

    for (const row of rows) {
      const list = result.get(row.source_symbol_id) ?? [];
      list.push({ targetName: row.target_name, kind: row.kind });
      result.set(row.source_symbol_id, list);
    }
  }

  return result;
}

export function buildScoredNodes(
  context: CapsuleContext,
  pivot: PivotResolution,
  selected: RankedCandidate[]
): ScoredNode[] {
  const maxScore = selected.reduce((max, item) => Math.max(max, item.score), 0);
  const root = getCommonDisplayRoot(selected.map((item) => item.file.path));
  const cache = new Map<number, FileRecord>();
  const outgoingEdgesMap = batchFetchOutgoingEdges(context, selected.map((candidate) => candidate.symbol.id));

  return selected.map(({ symbol, file, score, distance }) => {
    const fullSymbol = context.symbols.getById(symbol.id) ?? { ...symbol, fullSource: "" };
    const displayFile =
      cache.get(file.id) ??
      ({ ...file, path: toDisplayPath(file.path, root) } satisfies FileRecord);
    if (!cache.has(file.id)) cache.set(file.id, displayFile);

    const outgoingEdges = outgoingEdgesMap.get(symbol.id);
    let compressionLevel = assignCompressionLevel(score, distance, maxScore);
    if (pivot.intent !== "narrow" && compressionLevel === 0) {
      const pathLower = displayFile.path.toLowerCase();
      const actionSignal = hasActionSignal(symbol.name, symbol.signature);
      if (!actionSignal && PAGE_ENTRY_PATH_RE.test(pathLower)) {
        compressionLevel = 1;
      } else if (!actionSignal && UI_COMPONENT_PATH_RE.test(pathLower)) {
        compressionLevel = 2;
      }
    }
    const rendered = renderSymbol(fullSymbol, displayFile, compressionLevel);
    const tokenCount = estimateTokens(rendered);
    return { symbol: fullSymbol, file: displayFile, score, distance, compressionLevel, rendered, tokenCount, outgoingEdges };
  });
}

function tokenizeSymbolName(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function computeQueryOverlap(symbolName: string, pivotQueryTerms: string[], signature?: string, filePath?: string): number {
  const queryTermSet = new Set(pivotQueryTerms.map((term) => term.toLowerCase()));
  const nameTokens = new Set(tokenizeSymbolName(symbolName));
  let overlap = 0;
  for (const token of nameTokens) {
    if (queryTermSet.has(token)) overlap += 1;
  }
  if (overlap === 0 && signature) {
    const signatureLower = signature.toLowerCase();
    for (const term of queryTermSet) {
      if (signatureLower.includes(term)) {
        overlap += 1;
        break;
      }
    }
  }
  if (overlap === 0 && filePath) {
    const pathTokens = filePath.toLowerCase().replace(/[_\-./\\]/g, " ").split(/\s+/);
    for (const token of pathTokens) {
      if (queryTermSet.has(token)) {
        overlap += 1;
        break;
      }
    }
  }
  return overlap;
}

function hasStrongLocality(candidate: RankedCandidate, graph: GraphExpansion, pivot: PivotResolution): boolean {
  if (graph.pivotFileIds.has(candidate.file.id)) return true;
  if (!graph.rankingPivotDirs.has(dirname(normalizeRetrievalPath(candidate.file.path, 6)))) return false;
  const dirDistanceCap = pivot.intent === "narrow" ? 2 : 1;
  return candidate.distance <= dirDistanceCap;
}

function hasDirectEdgeToPivot(context: CapsuleContext, pivot: PivotResolution, symbolId: number): boolean {
  const callers = context.getDirectCallerIds.all(symbolId) as Array<{ symbolId: number }>;
  for (const row of callers) {
    if (pivot.pivotSymbolIds.has(row.symbolId)) return true;
  }
  const callees = context.getDirectCalleeIds.all(symbolId) as Array<{ symbolId: number }>;
  for (const row of callees) {
    if (pivot.pivotSymbolIds.has(row.symbolId)) return true;
  }
  return false;
}

function filterCandidatesBySymbolRelevance(
  candidates: RankedCandidate[],
  pivot: PivotResolution
): RankedCandidate[] {
  if (pivot.intent === "broad" || pivot.allQueryTerms.length === 0 || candidates.length === 0) {
    return candidates;
  }
  const queryTermSet = new Set(pivot.allQueryTerms.map((term) => term.toLowerCase()));
  const topScore = candidates[0]?.score ?? 0;
  return candidates.filter((candidate) => {
    if (candidate.distance === 0 || candidate.distance === 1) return true;
    const nameTokens = tokenizeCoverageTerms(candidate.symbol.name);
    const sigTokens = tokenizeCoverageTerms(candidate.symbol.signature ?? "");
    const hasQueryOverlap = [...nameTokens, ...sigTokens].some((term) => queryTermSet.has(term));
    const hasHighScore = topScore > 0 && candidate.score >= topScore * 0.35;
    return hasQueryOverlap || hasHighScore;
  });
}

function selectCandidates(
  context: CapsuleContext,
  pivot: PivotResolution,
  graph: GraphExpansion,
  ranked: RankedCandidate[],
  lexThreshold: number,
  maxDist: number,
  limit: number
): RankedCandidate[] {
  const ids = new Set<number>();
  const result: RankedCandidate[] = [];

  for (const candidate of ranked) {
    if (!candidate.isPivot) continue;
    const preservePivot =
      pivot.intent === "narrow" ||
      pivot.intent === "symbol-lookup" ||
      pivot.queryUiFocused ||
      !isUiLikePath(candidate.file.path) ||
      hasActionSignal(candidate.symbol.name, candidate.symbol.signature);
    if (!preservePivot) continue;
    result.push(candidate);
    ids.add(candidate.symbol.id);
  }

  for (const candidate of ranked) {
    if (result.length >= limit) break;
    if (ids.has(candidate.symbol.id)) continue;
    const hasLexical = candidate.lexicalScore >= lexThreshold;
    const isNearby = candidate.distance <= maxDist;
    if (pivot.intent === "narrow") {
      if (!hasLexical && !isNearby) continue;
      const overlap = computeQueryOverlap(candidate.symbol.name, pivot.pivotQueryTerms, candidate.symbol.signature, candidate.file.path);
      if (overlap === 0 && !hasDirectEdgeToPivot(context, pivot, candidate.symbol.id)) continue;
    } else if (pivot.intent === "broad") {
      const topScore = ranked[0]?.score ?? 0;
      const broadScoreFloor = topScore * 0.12;
      if (candidate.score < broadScoreFloor && !hasLexical) continue;
    } else {
      const strongLocality = hasStrongLocality(candidate, graph, pivot);
      if (!(strongLocality || (hasLexical && isNearby))) continue;
    }
    result.push(candidate);
    ids.add(candidate.symbol.id);
  }

  return result;
}

function pruneByFileDiversity(
  selectedCandidates: RankedCandidate[],
  pivot: PivotResolution,
  graph: GraphExpansion,
  tokenBudget: number
): RankedCandidate[] {
  if (selectedCandidates.length === 0) return selectedCandidates;
  const isNarrowMultiTerm = pivot.intent === "narrow" && pivot.exactQueryTerms.length >= 3;
  const broadBudgetBoost = pivot.intent === "broad" && tokenBudget >= 8000;
  if (pivot.intent === "narrow" && !isNarrowMultiTerm) {
    return selectedCandidates;
  }

  const maxFiles = isNarrowMultiTerm ? 4 : pivot.intent === "broad" ? (broadBudgetBoost ? 18 : 14) : 7;
  const maxPerFile = isNarrowMultiTerm ? 4 : pivot.intent === "broad" ? (broadBudgetBoost ? 6 : 4) : 4;
  const maxTotal = isNarrowMultiTerm ? 20 : pivot.intent === "broad" ? (broadBudgetBoost ? 80 : 50) : 24;
  const lexicalFloor = isNarrowMultiTerm ? 2 : pivot.intent === "broad" ? (broadBudgetBoost ? 0.9 : 1.5) : 1.2;
  const ordered = [...selectedCandidates].sort((a, b) => {
    if (a.isPivot !== b.isPivot) return a.isPivot ? -1 : 1;
    return b.score - a.score;
  });
  const topScore = ordered[0]?.score ?? 0;
  const scoreFloor = topScore * (isNarrowMultiTerm ? 0.7 : pivot.intent === "broad" ? (broadBudgetBoost ? 0.4 : 0.6) : 0.55);

  const kept: RankedCandidate[] = [];
  const includedFiles = new Set<number>();
  const perFileCount = new Map<number, number>();

  for (const candidate of ordered) {
    if (kept.length >= maxTotal) break;
    const fileId = candidate.file.id;
    const existingCount = perFileCount.get(fileId) ?? 0;
    const introducesFile = !includedFiles.has(fileId);
    const strongLocality = hasStrongLocality(candidate, graph, pivot);
    if (!candidate.isPivot) {
      if (introducesFile && includedFiles.size >= maxFiles) continue;
      if (existingCount >= maxPerFile) continue;
      if (!strongLocality && candidate.lexicalScore < lexicalFloor && candidate.score < scoreFloor) continue;
    }
    kept.push(candidate);
    includedFiles.add(fileId);
    perFileCount.set(fileId, existingCount + 1);
  }
  return kept;
}

function backfillWithinSelectedFiles(
  context: CapsuleContext,
  pivot: PivotResolution,
  _graph: GraphExpansion,
  ranked: RankedCandidate[],
  selectedCandidates: RankedCandidate[]
): RankedCandidate[] {
  if (pivot.intent !== "broad" || context.tokenBudget < 4000 || selectedCandidates.length >= 10) {
    return selectedCandidates;
  }
  const applyTestFilePenalty = context.mode === "review" || context.mode === "feature";
  const selectedIds = new Set<number>(selectedCandidates.map((candidate) => candidate.symbol.id));
  const selectedFileIds = new Set<number>(selectedCandidates.map((candidate) => candidate.file.id));
  if (selectedFileIds.size === 0) return selectedCandidates;

  const scoreBackfillCandidate = (symbol: LightSymbolRecord, lexicalScore: number, filePath: string): number => {
    const queryOverlap = computeQueryOverlap(symbol.name, pivot.pivotQueryTerms, symbol.signature, filePath);
    if (queryOverlap === 0 && lexicalScore < 0.3) return 0;
    const centralityContrib = Math.min(symbol.centrality * 0.3, 0.2);
    let score = queryOverlap * 8 + lexicalScore * 2 + centralityContrib;
    if (queryOverlap === 0) score *= 0.3;
    if (applyTestFilePenalty && isTestFile(filePath)) score *= 0.2;
    return score;
  };

  const rankedExtras = ranked.filter((candidate) =>
    !selectedIds.has(candidate.symbol.id) &&
    selectedFileIds.has(candidate.file.id) &&
    candidate.distance <= 2
  );

  const extras: RankedCandidate[] = [];
  for (const candidate of rankedExtras) {
    const queryOverlap = computeQueryOverlap(candidate.symbol.name, pivot.pivotQueryTerms, candidate.symbol.signature, candidate.file.path);
    if (queryOverlap === 0 && !hasDirectEdgeToPivot(context, pivot, candidate.symbol.id)) continue;
    const score = scoreBackfillCandidate(candidate.symbol, candidate.lexicalScore, candidate.file.path);
    if (score <= 0) continue;
    extras.push({ ...candidate, score });
  }

  const extraIds = new Set<number>(extras.map((candidate) => candidate.symbol.id));
  if (selectedCandidates.length + extras.length < 10) {
    for (const fileId of selectedFileIds) {
      const file = context.files.getById(fileId);
      if (!file) continue;
      const fallbackFilePath = file.path;
      for (const symbol of context.symbols.getByFileIdLight(fileId)) {
        if (selectedIds.has(symbol.id) || extraIds.has(symbol.id)) continue;
        const queryOverlap = computeQueryOverlap(symbol.name, pivot.pivotQueryTerms, symbol.signature, fallbackFilePath);
        if (queryOverlap === 0 && !hasDirectEdgeToPivot(context, pivot, symbol.id)) continue;
        const lexicalScore = getLexicalScore(symbol, file, pivot.expandedQueryTerms, pivot.exactQueryTermSet);
        const score = scoreBackfillCandidate(symbol, lexicalScore, fallbackFilePath);
        if (score <= 0) continue;
        extras.push({ symbol, file, score, distance: 2, traversalBoost: 1, isPivot: false, lexicalScore, degree: 0 });
        extraIds.add(symbol.id);
      }
    }
  }

  if (extras.length === 0) return selectedCandidates;
  extras.sort((a, b) => (a.lexicalScore !== b.lexicalScore ? b.lexicalScore - a.lexicalScore : b.score - a.score));
  const maxPerFile = 4;
  const perFileCounts = new Map<number, number>();
  const cappedExtras: RankedCandidate[] = [];
  for (const extra of extras) {
    const fileId = extra.file.id;
    const count = perFileCounts.get(fileId) ?? 0;
    if (count >= maxPerFile) continue;
    cappedExtras.push(extra);
    perFileCounts.set(fileId, count + 1);
  }
  const targetCount = Math.min(12, selectedCandidates.length + cappedExtras.length);
  return [...selectedCandidates, ...cappedExtras.slice(0, Math.max(0, targetCount - selectedCandidates.length))];
}

export function buildClusterBySymbolId(context: CapsuleContext, nodes: ScoredNode[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const node of nodes) {
    const clusterId = getFileClusterId(context.db, node.file.id);
    if (clusterId !== null) {
      map.set(node.symbol.id, clusterId);
    }
  }
  return map;
}

export function scoreCandidates(
  context: CapsuleContext,
  pivot: PivotResolution,
  graph: GraphExpansion
): CandidateScoringResult {
  const queryLooksDocFocused = pivot.allQueryTerms.some((term) => ["doc", "docs", "documentation", "readme", "guide", "tutorial", "manual", "changelog", "plan", "plans"].includes(term.toLowerCase()));
  const vendorFileRe = /(^|\/)(vendor|static\/js|assets\/js|public\/js|dist|build|\.next|coverage|\.worktrees?|\.claude|\.qa-temp|__pycache__|\.git|node_modules)\//i;
  const knownVendorNames = /\b(jquery|modernizr|bootstrap|lodash|moment|popper|aos|plugins|polyfill|bundle)\b/i;
  const vendoredTemplateRe = /\/(?:template|theme|starter|boilerplate)s?[/-]/i;
  const minifiedFileRe = /\.min\.(js|css)$/i;
  const docFileRe = /\.(md|txt|rst|adoc)$/i;
  const archiveWeightThreshold = 0.2;
  const nameFileCounts = new Map<string, number>();
  {
    const nameFileIds = new Map<string, Set<number>>();
    for (const candidate of graph.candidates) {
      const name = candidate.symbol.name.toLowerCase();
      const fileIds = nameFileIds.get(name) ?? new Set<number>();
      fileIds.add(candidate.file.id);
      nameFileIds.set(name, fileIds);
    }
    for (const [name, fileIds] of nameFileIds) {
      nameFileCounts.set(name, fileIds.size);
    }
  }

  const candidates: RankedCandidate[] = [];
  for (const candidate of graph.candidates) {
    const sameFileAsPivot = graph.pivotFileIds.has(candidate.file.id);
    const normalizedPath = normalizeRetrievalPath(candidate.file.path, 6);
    const sameDirAsPivot = graph.rankingPivotDirs.has(dirname(normalizedPath));
    const directoryWeight = getDirectoryWeight(normalizedPath, context.params.projectRoot);
    if (directoryWeight <= archiveWeightThreshold && !candidate.isPivot) continue;
    const noisyTestFile = isNoisyTestFile(candidate.file.path);
    if ((pivot.intent === "broad" || pivot.intent === "task" || pivot.intent === "narrow")) {
      if (!pivot.queryLooksTestFocused && context.mode !== "debug" && noisyTestFile) {
        if (!candidate.isPivot) continue;
        if (candidate.lexicalScore === 0) continue;
      }
      if (!queryLooksDocFocused && docFileRe.test(candidate.file.path)) continue;
      if (vendorFileRe.test(candidate.file.path) || knownVendorNames.test(candidate.file.path) || vendoredTemplateRe.test(candidate.file.path) || minifiedFileRe.test(candidate.file.path)) {
        continue;
      }
    }

    const laneWeight = pivot.activeLanes.length > 0 ? getLaneWeightForPath(pivot.activeLanes, candidate.file.path) : 1;
    const fileSearchBoost = pivot.candidateFileBoostById.get(candidate.file.id) ?? 1;
    const actionSignal = hasActionSignal(candidate.symbol.name, candidate.symbol.signature);
    const uiPathPenalty =
      !pivot.queryUiFocused &&
      (pivot.intent === "broad" || pivot.intent === "task" || pivot.intent === "debug") &&
      isUiLikePath(normalizedPath)
        ? actionSignal ? 0.82 : 0.58
        : 1;
    const testFilePenalty = !pivot.queryLooksTestFocused && context.mode !== "debug" && noisyTestFile ? 0.3 : 1;
    const localityBoost =
      (sameFileAsPivot ? 1.35 : sameDirAsPivot ? 1.2 : 1) *
      directoryWeight *
      laneWeight *
      uiPathPenalty *
      testFilePenalty *
      fileSearchBoost;
    const lexicalBoost = 1 + Math.min(1.5, candidate.lexicalScore * 0.3);
    const exactPivotBoost = pivot.exactPivotIds.has(candidate.symbol.id) ? 6 : 1;

    let hubPenalty = 1;
    if (!candidate.isPivot && candidate.distance > 0) {
      const centralityPressure =
        graph.centralityHubThreshold > 0
          ? Math.max(0, (candidate.symbol.centrality - graph.centralityHubThreshold) / graph.centralityHubThreshold)
          : 0;
      const degreePressure =
        graph.degreeHubThreshold > 0
          ? Math.max(0, (candidate.degree - graph.degreeHubThreshold) / graph.degreeHubThreshold)
          : 0;
      const hubPressure = Math.max(centralityPressure, degreePressure);
      if (hubPressure > 0) {
        const lexicalRelief = Math.min(pivot.intent === "narrow" ? 0.4 : 0.25, candidate.lexicalScore * 0.08);
        const dampeningWeight = pivot.intent === "narrow" ? 0.6 : pivot.intent === "broad" ? 0.8 : 0.9;
        const floor = pivot.intent === "narrow" ? 0.25 : 0.15;
        hubPenalty = Math.max(floor, 1 - hubPressure * dampeningWeight + lexicalRelief);
      }
    }

    const scored = {
      ...candidate,
      score:
        scoreNode({
          distance: candidate.distance,
          centrality: candidate.symbol.centrality,
          lastSeen: candidate.symbol.lastSeen,
          observationCount:
            (graph.observationCountBySymbol.get(candidate.symbol.id) ?? 0) +
            (graph.observationCountByFile.get(candidate.symbol.fileId) ?? 0),
          isExported: candidate.symbol.isExported,
          isPivot: candidate.isPivot,
          lexicalBoost,
          localityBoost,
          hubPenalty,
          visibilityMultiplier: getVisibilityPenalty(candidate.symbol.visibility, sameFileAsPivot, candidate.distance),
          mode: context.mode,
        }) * getRuntimeKindWeight(candidate.symbol.kind, pivot.preferRuntimeKinds) * exactPivotBoost * candidate.traversalBoost,
    };

    if (context.mode !== "debug" && scored.lexicalScore === 0 && scored.distance > 1) {
      scored.score *= 0.4;
    }
    if (!scored.isPivot && scored.lexicalScore === 0) {
      const nameFreq = nameFileCounts.get(scored.symbol.name.toLowerCase()) ?? 1;
      if (nameFreq > 5) {
        scored.score *= Math.min(1, 5 / nameFreq);
      }
    }
    if (context.mode !== "debug" && scored.distance > 0 && !pivot.queryLooksTestFocused && noisyTestFile) {
      scored.score *= 0.3;
    }
    candidates.push(scored);
  }

  const hybridCandidates = applyHybridScoreBlend(context, pivot, candidates);
  let ranked = [...hybridCandidates].sort((a, b) => b.score - a.score);
  ranked = filterCandidatesBySymbolRelevance(ranked, pivot);

  const hasObservationPayload = pivot.observations.some((observation) => observation.note.trim().length > 0 && observation.confidence > 0);
  const codeRatio = hasObservationPayload && pivot.intent === "narrow" ? 0.8 : 1.0;
  void codeRatio;

  const isSingleFocusNarrowQuery = pivot.intent === "narrow" && pivot.exactQueryTerms.length <= 3;
  const baseLexThreshold = pivot.exactQueryTerms.length === 0 ? 0 : isSingleFocusNarrowQuery ? 2 : 1;
  const broadLargeBudget = pivot.intent === "broad" && context.tokenBudget >= 8000;
  const candidateLimitMultiplier = pivot.intent === "narrow" ? 0.85 : pivot.intent === "broad" ? (broadLargeBudget ? 0.8 : 0.6) : 0.55;
  const dynamicLimit = Math.max(40, Math.floor((pivot.retrievalBudget / 10) * candidateLimitMultiplier));
  const narrowHardCap = isSingleFocusNarrowQuery ? 48 : 80;
  const hardCap =
    pivot.intent === "narrow"
      ? narrowHardCap
      : pivot.intent === "broad"
        ? Math.max(broadLargeBudget ? 400 : 280, Math.floor(context.tokenBudget / (broadLargeBudget ? 18 : 28)))
        : 150;
  const baseCandidateLimit = Math.min(dynamicLimit, hardCap);

  let selected = backfillWithinSelectedFiles(
    context,
    pivot,
    graph,
    ranked,
    ensureBroadFileSpread(
      pruneUiNoise(
        pruneByFileDiversity(
          selectCandidates(context, pivot, graph, ranked, baseLexThreshold, pivot.intent === "task" ? 0 : pivot.intent === "broad" ? 2 : isSingleFocusNarrowQuery ? 0 : 1, baseCandidateLimit),
          pivot,
          graph,
          context.tokenBudget
        ),
        { intent: pivot.intent, queryUiFocused: pivot.queryUiFocused }
      ),
      {
        intent: pivot.intent,
        tokenBudget: context.tokenBudget,
        queryUiFocused: pivot.queryUiFocused,
        ranked,
        visited: graph.visited,
        getFileSymbols: (fileId) => context.symbols.getByFileIdLight(fileId),
        files: context.files.iterateAll(),
        pivotQueryTerms: pivot.pivotQueryTerms,
      }
    )
  );

  const selectedIds = new Set(selected.map((candidate) => candidate.symbol.id));
  if ((pivot.intent === "broad" || pivot.intent === "task") && selected.length > 0 && selected.length < baseCandidateLimit) {
    const layerPatterns: Array<{ name: string; re: RegExp }> = [
      { name: "ui", re: /(^|\/)(?:components?|views?|pages?|app\/(?!api))[/\\]/i },
      { name: "api", re: /(^|\/)(?:api|routes?|controllers?|app\/api)[/\\]/i },
      { name: "service", re: /(^|\/)(?:services?|lib\/server|server|utils?|helpers?)[/\\]/i },
      { name: "data", re: /(^|\/)(?:db|data|models?|repositories?|stores?|convex|supabase)[/\\]/i },
    ];
    const coveredLayers = new Set<string>();
    for (const candidate of selected) {
      for (const layerPattern of layerPatterns) {
        if (layerPattern.re.test(candidate.file.path)) coveredLayers.add(layerPattern.name);
      }
    }
    if (coveredLayers.size < 2) {
      for (const layerPattern of layerPatterns) {
        if (coveredLayers.has(layerPattern.name)) continue;
        const layerCandidate = ranked.find((candidate) =>
          !selectedIds.has(candidate.symbol.id) &&
          layerPattern.re.test(candidate.file.path) &&
          candidate.lexicalScore > 0
        );
        if (layerCandidate) {
          selected.push(layerCandidate);
          selectedIds.add(layerCandidate.symbol.id);
          coveredLayers.add(layerPattern.name);
          context.logger.debug("layer-fill", { layer: layerPattern.name, symbol: layerCandidate.symbol.name, file: layerCandidate.file.path });
        }
      }
    }
  }

  let scoredNodes = buildScoredNodes(context, pivot, selected);
  let layerCoverages: LayerCoverage[] = [];
  if ((pivot.intent === "broad" || pivot.intent === "task") && context.params.projectRoot) {
    const lanes = getRetrievalLanes(context.db, context.params.projectRoot);
    const expectedLayers = getExpectedLayers(context.db, context.params.projectRoot);
    if (lanes.length > 0 && expectedLayers.length > 0) {
      const coverageResult = checkChainCoverage(context.db, context.params.projectRoot, scoredNodes, expectedLayers, lanes);
      layerCoverages = coverageResult.coverages;
      if (coverageResult.fillNodes.length > 0) {
        scoredNodes = [...scoredNodes, ...coverageResult.fillNodes];
      }
    }
  }

  return {
    candidates: hybridCandidates,
    ranked,
    selected,
    scoredNodes,
    clusterBySymbolId: buildClusterBySymbolId(context, scoredNodes),
    layerCoverages,
  };
}

function isNoisyTestFile(filePath: string): boolean {
  if (isTestFile(filePath)) return true;
  const lower = filePath.toLowerCase().replaceAll("\\", "/");
  return lower.includes("/mock") || lower.includes("/fixture") || lower.includes("/__mocks__/") || lower.includes("/fixtures/");
}

function normalizeRetrievalPath(path: string, maxSegments: number): string {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(-maxSegments).join("/");
}
