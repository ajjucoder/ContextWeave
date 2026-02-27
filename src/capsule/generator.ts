import type Database from "better-sqlite3";
import { dirname } from "node:path";
import type {
  CapsuleOutput,
  CapsuleMode,
  ScoredNode,
  CapsuleMetadata,
  CompressionLevel,
  LightSymbolRecord,
  FileRecord,
} from "../core/types.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { fileQueries } from "../db/queries/files.js";
import { getBatchSymbolDegrees } from "../core/graph.js";
import { weightedBfsTraversal } from "../core/weighted-bfs.js";
import { fuzzyMatch } from "../utils/fuzzy.js";
import { countTokens } from "../utils/tokens.js";
import { expandQueryWithSynonyms } from "../utils/synonyms.js";
import { getDirectoryWeight } from "../utils/directory-weights.js";
import { scoreNode, assignCompressionLevel } from "./scorer.js";
import { rankPivotsWithScores } from "./pivot-scorer.js";
import { renderSymbol } from "./compressor.js";
import { packNodes, packNodesStoryMode } from "./packer.js";
import { formatCapsule } from "./formatter.js";
import { diagnose } from "./diagnostics.js";
import { classifyQueryIntent } from "./intent-classifier.js";
import { createLogger } from "../utils/logger.js";
import { MemorySearch } from "../memory/search.js";
import { capsuleLogQueries } from "../db/queries/capsule-log.js";
import { sessionQueries } from "../db/queries/sessions.js";
import { captureQueryObservation } from "../memory/passive.js";
import { SessionContext } from "./session-context.js";
import {
  decomposeForBroad,
  decomposeForTask,
  decomposeQuery,
  mergeSubQueryTerms,
  type ClusterHint,
} from "./query-decomposer.js";
import { mergeSubCapsules, type SubCapsuleResult } from "./merger.js";
import { searchFilesByQuery } from "../core/file-summaries.js";
import { getFileClusterId, getClusterFileIds } from "../core/clusters.js";
import { buildUncertainty, computeCoverageConfidence } from "./confidence.js";
import {
  getCommonDisplayRoot,
  getLexicalScore,
  isTestFile,
  isTestQuery,
  quantile,
  toDisplayPath,
} from "./generator-helpers.js";

const logger = createLogger("generator");
export { computeCoverageConfidence } from "./confidence.js";

interface CapsuleParams {
  query: string;
  tokenBudget?: number;
  mode?: CapsuleMode;
  sessionId?: string;
  projectRoot?: string;
  maxQueryTimeMs?: number;
}

interface RankedCandidate {
  symbol: LightSymbolRecord;
  file: FileRecord;
  score: number;
  distance: number;
  isPivot: boolean;
  lexicalScore: number;
  degree: number;
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
  const maxQueryTimeMs = params.maxQueryTimeMs ?? 500;
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  const isOverBudget = (fraction: number) => elapsed() > maxQueryTimeMs * fraction;

  logger.info("generating capsule", { query, tokenBudget, mode });

  const symbols = symbolQueries(db);
  const files = fileQueries(db);
  const classified = classifyQueryIntent(query);
  const intent = classified.intent;
  const retrievalBudget = Math.max(
    tokenBudget,
    Math.round(tokenBudget * classified.suggestedBudgetMultiplier)
  );

  // Phase 1: Pivot Resolution
  const pathCandidateCache = new Map<string, FileRecord>();
  const getPathCandidates = (term: string): string[] => {
    if (term.length < 2) return [];
    const candidates = files.searchByPath(term, 150);
    for (const file of candidates) {
      pathCandidateCache.set(file.path, file);
    }
    return candidates.map((file) => file.path);
  };

  const queryGroups = decomposeQuery(query);
  const fallbackTerms = queryGroups.length > 0
    ? mergeSubQueryTerms(queryGroups)
    : query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const intentTerms =
    intent === "task"
      ? (classified.focusTerms.length > 0 ? classified.focusTerms : classified.normalizedTerms)
      : classified.normalizedTerms;
  const baseQueryTerms = intentTerms.length > 0 ? intentTerms : fallbackTerms;
  const rawPivotIds = new Set<number>();

  const FILE_SEARCH_LIMIT = intent === "narrow" ? 50 : 80;
  const candidateFiles = searchFilesByQuery(db, query, FILE_SEARCH_LIMIT);
  let candidateFileIds = candidateFiles.length > 0
    ? new Set(candidateFiles.map((f) => f.fileId))
    : null;
  if ((intent === "broad" || intent === "task") && candidateFileIds && candidateFileIds.size < 12) {
    candidateFileIds = null;
  }
  const clusterHintMap = new Map<number, { id: number; terms: Set<string>; relevance: number }>();

  for (const candidate of candidateFiles) {
    const clusterId = getFileClusterId(db, candidate.fileId);
    if (clusterId === null) continue;
    const cluster = clusterHintMap.get(clusterId) ?? { id: clusterId, terms: new Set<string>(), relevance: 0 };
    cluster.relevance += 1;
    const pathTokens = candidate.path.toLowerCase().replace(/[^a-z0-9/_-]/g, " ").split(/[\/\s_-]+/).filter(Boolean);
    for (const token of pathTokens.slice(-4)) {
      if (token.length > 2) cluster.terms.add(token);
    }
    clusterHintMap.set(clusterId, cluster);
  }
  const clusterHints: ClusterHint[] = [...clusterHintMap.values()].map((cluster) => ({
    id: cluster.id,
    terms: [...cluster.terms],
    relevance: cluster.relevance,
  }));
  const impliedModuleDirs = new Set<string>();
  if (classified.impliedModules.length > 0) {
    for (const candidate of candidateFiles) {
      const lowerPath = candidate.path.toLowerCase();
      if (classified.impliedModules.some((module) => lowerPath.includes(module))) {
        impliedModuleDirs.add(dirname(candidate.path));
      }
    }
  }

  const subQueries =
    intent === "broad"
      ? decomposeForBroad(query, classified, clusterHints)
      : intent === "task"
        ? decomposeForTask(query, classified, clusterHints)
        : [];
  const useMultiPass = intent !== "narrow" && subQueries.length > 1;
  const allQueryTerms = useMultiPass
    ? mergeSubQueryTerms(subQueries.map((subQuery) => subQuery.terms))
    : baseQueryTerms;
  const exactQueryTerms = baseQueryTerms;
  const expandedQueryTerms = expandQueryWithSynonyms(allQueryTerms);
  const exactQueryTermSet = new Set(exactQueryTerms);
  const queryLooksTestFocused = isTestQuery(allQueryTerms);

  if (candidateFileIds && candidateFileIds.size > 0) {
    const MAX_CANDIDATE_FILES = 100;
    for (const fileId of [...candidateFileIds]) {
      if (candidateFileIds.size >= MAX_CANDIDATE_FILES) break;
      const clusterId = getFileClusterId(db, fileId);
      if (clusterId !== null) {
        for (const clusteredFileId of getClusterFileIds(db, clusterId)) {
          if (candidateFileIds.size >= MAX_CANDIDATE_FILES) break;
          candidateFileIds.add(clusteredFileId);
        }
      }
    }
  }

  if (candidateFileIds && subQueries.length > 0) {
    for (const subQuery of subQueries) {
      for (const clusterId of subQuery.targetClusterIds) {
        for (const fileId of getClusterFileIds(db, clusterId)) {
          if (candidateFileIds.size >= 140) break;
          candidateFileIds.add(fileId);
        }
      }
    }
  }

  const perTermSymbolCap =
    intent === "narrow" ? 15 : intent === "broad" ? 10 : 12;
  const perTermPathMatchCap = intent === "narrow" ? 3 : 1;
  const maxStageARaw =
    intent === "narrow"
      ? Number.POSITIVE_INFINITY
      : intent === "broad"
        ? Math.max(120, Math.floor(retrievalBudget / 140))
        : Math.max(160, Math.floor(retrievalBudget / 120));

  for (const term of expandedQueryTerms) {
    if (rawPivotIds.size >= maxStageARaw) break;

    if (term.length >= 3) {
      const ftsMatches = symbols.searchFTS(term, perTermSymbolCap);
      const filtered = candidateFileIds
        ? ftsMatches.filter((s) => candidateFileIds.has(s.fileId))
        : ftsMatches;
      for (const symbol of filtered.slice(0, perTermSymbolCap)) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
    } else {
      const matched = symbols.getByName(term);
      const filtered = candidateFileIds
        ? matched.filter((s) => candidateFileIds.has(s.fileId))
        : matched;
      for (const symbol of filtered.slice(0, perTermSymbolCap)) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
    }

    if (rawPivotIds.size >= maxStageARaw) break;

    const pathCandidates = getPathCandidates(term);
    const pathMatches = fuzzyMatch(term, pathCandidates, 0.4);
    for (const match of pathMatches.slice(0, perTermPathMatchCap)) {
      const file = pathCandidateCache.get(match.name);
      if (!file) continue;
      const fileSymbols = symbols.getByFileId(file.id);
      for (const symbol of fileSymbols) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
      if (rawPivotIds.size >= maxStageARaw) break;
    }
  }

  logger.debug("raw pivot candidates", { count: rawPivotIds.size });

  const MAX_PIVOTS =
    intent === "narrow"
      ? Math.max(30, Math.min(120, Math.floor(retrievalBudget / 50)))
      : intent === "broad"
        ? Math.max(40, Math.min(100, Math.floor(retrievalBudget / 160)))
        : Math.max(50, Math.min(120, Math.floor(retrievalBudget / 150)));
  const pivotCandidates: Array<{ id: number; name: string; signature: string; kind: string; filePath: string }> = [];
  const pivotFileCache = new Map<number, string>();
  for (const id of rawPivotIds) {
    const sym = symbols.getByIdLight(id);
    if (!sym) continue;
    let filePath = pivotFileCache.get(sym.fileId);
    if (filePath === undefined) {
      const file = files.getById(sym.fileId);
      filePath = file?.path ?? "";
      pivotFileCache.set(sym.fileId, filePath);
    }
    pivotCandidates.push({ id, name: sym.name, signature: sym.signature ?? "", kind: sym.kind, filePath });
  }

  const { ranked: rankedPivots, scores: pivotScores } = rankPivotsWithScores(
    pivotCandidates,
    exactQueryTerms,
    MAX_PIVOTS
  );

  const sessionId = params.sessionId ?? "default";
  sessionQueries(db).ensureSession(sessionId, params.projectRoot ?? "");
  const sessionCtx = new SessionContext(db, sessionId);

  const recentFileIds = new Set(sessionCtx.getRecentFileIds());
  if (recentFileIds.size > 0) {
    const filePathToFileId = new Map<string, number>();
    for (const [fileId, filePath] of pivotFileCache) {
      filePathToFileId.set(filePath, fileId);
    }
    for (const candidate of pivotCandidates) {
      const fileId = filePathToFileId.get(candidate.filePath);
      if (fileId !== undefined && recentFileIds.has(fileId)) {
        const existing = rankedPivots.get(candidate.id) ?? 0;
        if (existing > 0) {
          rankedPivots.set(candidate.id, existing * 1.5);
        } else {
          rankedPivots.set(candidate.id, 0.5);
        }
      }
    }
  }

  const pivotSymbolIds = new Set(rankedPivots.keys());
  const topLocalityPivotIds = new Set(
    [...rankedPivots.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, intent === "narrow" ? 20 : 12)
      .map(([id]) => id)
  );
  const pivotScoreValues = [...rankedPivots.values()].sort((a, b) => a - b);
  const medianPivotScore = pivotScoreValues.length > 0
    ? pivotScoreValues[Math.floor(pivotScoreValues.length / 2)] ?? 0
    : 0;
  const relevantPivotIds = new Set(
    [...rankedPivots.entries()]
      .filter(([, score]) => score >= medianPivotScore)
      .map(([id]) => id)
  );

  logger.debug("pivot symbols after ranking", { raw: rawPivotIds.size, ranked: pivotSymbolIds.size, relevant: relevantPivotIds.size });

  const memorySearch = new MemorySearch(db);
  const observationBudget = Math.floor(tokenBudget * 0.2);
  const { observations } = memorySearch.getRelevantForCapsule(query, observationBudget);

  const fileCache = new Map<number, FileRecord | undefined>();
  const getFile = (fileId: number): FileRecord | undefined => {
    if (!fileCache.has(fileId)) fileCache.set(fileId, files.getById(fileId));
    return fileCache.get(fileId);
  };

  const pivotFileIds = new Set<number>();
  const pivotDirs = new Set<string>();
  const localityPivotDirs = new Set<string>();
  for (const id of pivotSymbolIds) {
    const symbol = symbols.getById(id);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;
    pivotFileIds.add(file.id);
    pivotDirs.add(dirname(file.path));
    if (topLocalityPivotIds.has(id)) {
      localityPivotDirs.add(dirname(file.path));
    }
  }

  // Phase 2: Lazy BFS traversal keeps memory stable on large graphs.
  const skipBfs = isOverBudget(0.5);
  const baseDepth = getBfsDepth(retrievalBudget);
  const maxDepth =
    intent === "broad"
      ? Math.max(2, baseDepth - 1)
      : intent === "task"
        ? Math.min(6, baseDepth)
        : baseDepth;
  const rankingPivotDirs =
    intent === "narrow" || localityPivotDirs.size === 0
      ? pivotDirs
      : localityPivotDirs;
  const scopeDirSet = new Set<string>(rankingPivotDirs);
  if (intent === "task") {
    for (const dir of impliedModuleDirs) {
      scopeDirSet.add(dir);
    }
  }
  const scopeDirs = scopeDirSet.size > 0 ? [...scopeDirSet] : null;
  const bfsNodes = skipBfs
    ? [...pivotSymbolIds].map((id) => ({ symbolId: id, distance: 0 }))
    : weightedBfsTraversal(db, [...pivotSymbolIds], maxDepth, scopeDirs);
  const visited = new Map<number, number>(bfsNodes.map((n) => [n.symbolId, n.distance]));

  logger.debug("bfs traversal complete", { nodesVisited: visited.size });

  // Phase 3: Stage B reranking (intent + locality + hub dampening)
  const candidates: RankedCandidate[] = [];
  const centralityValues: number[] = [];
  const degreeValues: number[] = [];

  const allVisitedIds = [...visited.keys()];
  const batchDegrees = getBatchSymbolDegrees(db, allVisitedIds);

  for (const [symbolId, distance] of visited) {
    const symbol = symbols.getByIdLight(symbolId);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;

    const degree = batchDegrees.get(symbolId) ?? 0;
    const lexicalScore = getLexicalScore(symbol, file, expandedQueryTerms, exactQueryTermSet);

    centralityValues.push(symbol.centrality);
    degreeValues.push(degree);

    candidates.push({
      symbol,
      file,
      score: 0,
      distance,
      isPivot: pivotSymbolIds.has(symbolId),
      lexicalScore,
      degree,
    });
  }

  const centralityHubThreshold = quantile(centralityValues, 0.9);
  const degreeHubThreshold = quantile(degreeValues, 0.9);

  for (const candidate of candidates) {
    const sameFileAsPivot = pivotFileIds.has(candidate.file.id);
    const sameDirAsPivot = rankingPivotDirs.has(dirname(candidate.file.path));
    const directoryWeight = getDirectoryWeight(candidate.file.path);
    const testFilePenalty =
      !queryLooksTestFocused && isTestFile(candidate.file.path) ? 0.5 : 1;
    const localityBoost =
      (sameFileAsPivot ? 1.35 : sameDirAsPivot ? 1.2 : 1) *
      directoryWeight *
      testFilePenalty;
    const lexicalBoost = 1 + Math.min(1.5, candidate.lexicalScore * 0.3);

    let hubPenalty = 1;
    if (!candidate.isPivot && candidate.distance > 0) {
      const centralityPressure =
        centralityHubThreshold > 0
          ? Math.max(0, (candidate.symbol.centrality - centralityHubThreshold) / centralityHubThreshold)
          : 0;
      const degreePressure =
        degreeHubThreshold > 0
          ? Math.max(0, (candidate.degree - degreeHubThreshold) / degreeHubThreshold)
          : 0;
      const hubPressure = Math.max(centralityPressure, degreePressure);
      if (hubPressure > 0) {
        const lexicalRelief = Math.min(
          intent === "narrow" ? 0.4 : 0.25,
          candidate.lexicalScore * 0.08
        );
        const dampeningWeight =
          intent === "narrow" ? 0.6 : intent === "broad" ? 0.8 : 0.9;
        const floor = intent === "narrow" ? 0.25 : 0.15;
        hubPenalty = Math.max(
          floor,
          1 - hubPressure * dampeningWeight + lexicalRelief
        );
      }
    }

    candidate.score = scoreNode({
      distance: candidate.distance,
      centrality: candidate.symbol.centrality,
      lastSeen: candidate.symbol.lastSeen,
      observationCount: 0,
      isExported: candidate.symbol.isExported,
      isPivot: candidate.isPivot,
      lexicalBoost,
      localityBoost,
      hubPenalty,
      mode,
    });
  }

  const ranked = [...candidates].sort((a, b) => b.score - a.score);

  function selectCandidates(lexThreshold: number, maxDist: number, limit: number): RankedCandidate[] {
    const ids = new Set<number>();
    const result: RankedCandidate[] = [];

    for (const candidate of ranked) {
      if (!candidate.isPivot) continue;
      result.push(candidate);
      ids.add(candidate.symbol.id);
    }

    for (const candidate of ranked) {
      if (result.length >= limit) break;
      if (ids.has(candidate.symbol.id)) continue;
      const hasLexical = candidate.lexicalScore >= lexThreshold;
      const isNearby = candidate.distance <= maxDist;
      if (!hasLexical && !isNearby) continue;
      result.push(candidate);
      ids.add(candidate.symbol.id);
    }

    return result;
  }

  function buildScoredNodes(sel: RankedCandidate[]): ScoredNode[] {
    const maxSc = sel.reduce((max, item) => Math.max(max, item.score), 0);
    const root = getCommonDisplayRoot(sel.map((item) => item.file.path));
    const cache = new Map<number, FileRecord>();

    return sel.map(({ symbol, file, score, distance }) => {
      const fullSymbol = symbols.getById(symbol.id) ?? {
        ...symbol,
        fullSource: "",
      };
      const displayFile =
        cache.get(file.id) ??
        ({ ...file, path: toDisplayPath(file.path, root) } satisfies FileRecord);
      if (!cache.has(file.id)) cache.set(file.id, displayFile);

      const compressionLevel = assignCompressionLevel(score, distance, maxSc);
      const rendered = renderSymbol(fullSymbol, displayFile, compressionLevel);
      const tokenCount = countTokens(rendered);

      return { symbol: fullSymbol, file: displayFile, score, distance, compressionLevel, rendered, tokenCount };
    });
  }

  const hasObservationPayload = observations.some(
    (o) => o.note.trim().length > 0 && o.confidence > 0
  );
  const codeRatio = hasObservationPayload && intent === "narrow" ? 0.8 : 1.0;

  const baseLexThreshold = exactQueryTerms.length === 0 ? 0 : 1;
  const candidateLimitMultiplier =
    intent === "narrow" ? 1 : intent === "broad" ? 0.8 : 0.9;
  const dynamicLimit = Math.max(
    60,
    Math.floor((retrievalBudget / 10) * candidateLimitMultiplier)
  );
  const hardCap =
    intent === "narrow" ? 180 : intent === "broad" ? 200 : 220;
  const baseCandidateLimit = Math.min(dynamicLimit, hardCap);
  const NARROW_MIN_UTILIZATION = 0.45;
  const BROAD_TASK_MIN = 0.6;
  const BROAD_TASK_TARGET = 0.7;

  const recentSymbolIds: Set<number> = params.sessionId
    ? new Set(sessionCtx.getRecentSymbolIds().filter((id): id is number => id !== null))
    : new Set();

  const baseMaxDistance = intent === "task" ? 0 : intent === "broad" ? 2 : 1;
  let selected = selectCandidates(baseLexThreshold, baseMaxDistance, baseCandidateLimit);
  let scoredNodes = buildScoredNodes(selected);
  const buildClusterBySymbolId = (nodes: ScoredNode[]): Map<number, number> => {
    const map = new Map<number, number>();
    for (const node of nodes) {
      const clusterId = getFileClusterId(db, node.file.id);
      if (clusterId !== null) {
        map.set(node.symbol.id, clusterId);
      }
    }
    return map;
  };
  let clusterBySymbolId = buildClusterBySymbolId(scoredNodes);
  let packed: ScoredNode[] = [];
  let tokensUsed = 0;
  let fileSummaries: string[] = [];

  if (useMultiPass) {
    const subResults: SubCapsuleResult[] = [];
    for (const subQuery of subQueries) {
      const termSet = new Set(subQuery.terms);
      const filtered = scoredNodes.filter((node) => {
        const clusterId = clusterBySymbolId.get(node.symbol.id);
        const clusterMatch =
          subQuery.targetClusterIds.length === 0 ||
          (clusterId !== undefined && subQuery.targetClusterIds.includes(clusterId));
        if (!clusterMatch) return false;

        const haystack = `${node.symbol.name.toLowerCase()} ${node.symbol.signature.toLowerCase()} ${node.file.path.toLowerCase()}`;
        const lexicalMatch = [...termSet].some((term) => haystack.includes(term));
        return lexicalMatch || node.distance === 0;
      });
      if (filtered.length === 0) continue;

      const subBudget = Math.max(600, Math.floor(tokenBudget * subQuery.budgetFraction));
      const packedSub = packNodesStoryMode(filtered, subBudget, codeRatio, clusterBySymbolId);
      const pivotSubset = new Set<number>();
      const clusterIds = new Set<number>();
      for (const node of packedSub.packed) {
        if (pivotSymbolIds.has(node.symbol.id)) {
          pivotSubset.add(node.symbol.id);
        }
        const clusterId = clusterBySymbolId.get(node.symbol.id);
        if (clusterId !== undefined) {
          clusterIds.add(clusterId);
        }
      }
      subResults.push({
        packed: packedSub.packed,
        fileSummaries: packedSub.fileSummaries,
        pivotSymbolIds: pivotSubset,
        clusterIds,
      });
    }

    if (subResults.length > 0) {
      const merged = mergeSubCapsules(subResults, tokenBudget, codeRatio, clusterBySymbolId);
      packed = merged.packed;
      tokensUsed = merged.tokensUsed;
      fileSummaries = merged.fileSummaries;
    } else {
      const packedResult = packNodesStoryMode(scoredNodes, tokenBudget, codeRatio, clusterBySymbolId);
      packed = packedResult.packed;
      tokensUsed = packedResult.tokensUsed;
      fileSummaries = packedResult.fileSummaries;
    }
  } else if (intent === "broad" || intent === "task") {
    const packedResult = packNodesStoryMode(scoredNodes, tokenBudget, codeRatio, clusterBySymbolId);
    packed = packedResult.packed;
    tokensUsed = packedResult.tokensUsed;
    fileSummaries = packedResult.fileSummaries;
  } else {
    const packedResult = packNodes(scoredNodes, tokenBudget, codeRatio);
    packed = packedResult.packed;
    tokensUsed = packedResult.tokensUsed;
    fileSummaries = packedResult.fileSummaries;
  }

  const skipPromotion = isOverBudget(0.8);

  if (
    intent === "narrow" &&
    !skipPromotion &&
    tokenBudget >= 1000 &&
    tokensUsed < tokenBudget * NARROW_MIN_UTILIZATION &&
    candidates.length > selected.length
  ) {
    // Strategy 1: promote existing nodes to better compression (L3→L0)
    // by adding same-file/same-dir candidates that contribute L0-L2 content
    const promotionCandidates = candidates.filter((c) => {
      if (selected.some((s) => s.symbol.id === c.symbol.id)) return false;
      const sameFile = pivotFileIds.has(c.file.id);
      const sameDir = pivotDirs.has(dirname(c.file.path));
      return sameFile || sameDir || c.lexicalScore > 0;
    });
    const promoted = [...selected, ...promotionCandidates.slice(0, baseCandidateLimit)];
    const promotedNodes = buildScoredNodes(promoted);
    const promotedResult = packNodes(promotedNodes, tokenBudget, codeRatio, 0.15);

    if (promotedResult.tokensUsed > tokensUsed) {
      selected = promoted;
      scoredNodes = promotedNodes;
      packed = promotedResult.packed;
      tokensUsed = promotedResult.tokensUsed;
      fileSummaries = promotedResult.fileSummaries;
      logger.debug("auto-promote", { n: selected.length, tokensUsed });
    }
  }

  if (
    (intent === "broad" || intent === "task") &&
    !skipPromotion &&
    tokenBudget >= 2000 &&
    tokensUsed < tokenBudget * BROAD_TASK_MIN &&
    candidates.length > selected.length
  ) {
    const refillPasses = [
      {
        lexThreshold: Math.max(0, baseLexThreshold),
        maxDist: intent === "task" ? 1 : 2,
        limit: Math.min(candidates.length, baseCandidateLimit + 30),
      },
      {
        lexThreshold: 0,
        maxDist: 3,
        limit: Math.min(candidates.length, baseCandidateLimit + 40),
      },
    ];

    for (const pass of refillPasses) {
      const expanded = selectCandidates(pass.lexThreshold, pass.maxDist, pass.limit);
      if (expanded.length <= selected.length) continue;

      const expandedNodes = buildScoredNodes(expanded);
      const expandedClusterMap = buildClusterBySymbolId(expandedNodes);
      const expandedPackedResult = packNodesStoryMode(
        expandedNodes,
        tokenBudget,
        codeRatio,
        expandedClusterMap
      );

      if (expandedPackedResult.tokensUsed > tokensUsed) {
        selected = expanded;
        scoredNodes = expandedNodes;
        clusterBySymbolId = expandedClusterMap;
        packed = expandedPackedResult.packed;
        tokensUsed = expandedPackedResult.tokensUsed;
        fileSummaries = expandedPackedResult.fileSummaries;
        logger.debug("refill", { n: selected.length, tokensUsed });
      }

      if (tokensUsed >= tokenBudget * BROAD_TASK_TARGET) {
        break;
      }
    }
  }

  const relevanceLexicalThreshold = baseLexThreshold;

  if (recentSymbolIds.size > 0) {
    let tokensDelta = 0;
    for (let i = 0; i < packed.length; i++) {
      const node = packed[i]!;
      if (node.compressionLevel === 0 && recentSymbolIds.has(node.symbol.id)) {
        const dedupRendered = `[previously shown] ${node.symbol.signature}`;
        const dedupTokens = countTokens(dedupRendered);
        tokensDelta += dedupTokens - node.tokenCount;
        packed[i] = {
          ...node,
          compressionLevel: 2,
          rendered: dedupRendered,
          tokenCount: dedupTokens,
        };
      }
    }
    tokensUsed += tokensDelta;
    logger.debug("dedup pass complete", { recentCount: recentSymbolIds.size, tokensDelta });
  }

  // Phase 7: Quality gate + format + return
  const compressionBreakdown: Record<CompressionLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const node of packed) {
    compressionBreakdown[node.compressionLevel]++;
  }

  const packedIds = new Set(packed.map((node) => node.symbol.id));
  const pivotsIncluded = [...pivotSymbolIds].filter((id) => packedIds.has(id)).length;
  const pivotCount = pivotSymbolIds.size;
  const pivotCoverage = pivotCount === 0 ? 0 : pivotsIncluded / pivotCount;
  const selectedById = new Map(selected.map((candidate) => [candidate.symbol.id, candidate]));
  const selectedNonPivots = selected.filter((candidate) => !candidate.isPivot).length;
  const packedNonPivots = packed.filter((node) => !pivotSymbolIds.has(node.symbol.id)).length;
  const dependencyCoverage =
    selectedNonPivots === 0
      ? (selected.length === 0 ? 0 : 1)
      : packedNonPivots / selectedNonPivots;
  const lowRelevancePacked = packed.filter((node) => {
    if (pivotSymbolIds.has(node.symbol.id)) return false;
    const selectedCandidate = selectedById.get(node.symbol.id);
    return (selectedCandidate?.lexicalScore ?? 0) < relevanceLexicalThreshold;
  }).length;
  const noiseRatio = packed.length === 0 ? 0 : lowRelevancePacked / packed.length;
  const relevantPivotsIncluded = packed.filter((node) => relevantPivotIds.has(node.symbol.id)).length;
  const relevantClusters = new Set<number>();
  for (const candidate of selected) {
    const clusterId = clusterBySymbolId.get(candidate.symbol.id);
    if (clusterId !== undefined) {
      relevantClusters.add(clusterId);
    }
  }
  const packedClusters = new Set<number>();
  const fileSymbolCounts = new Map<string, number>();
  for (const node of packed) {
    const clusterId = clusterBySymbolId.get(node.symbol.id);
    if (clusterId !== undefined) {
      packedClusters.add(clusterId);
    }
    fileSymbolCounts.set(node.file.path, (fileSymbolCounts.get(node.file.path) ?? 0) + 1);
  }
  const fileCounts = [...fileSymbolCounts.values()];
  const avgSymbolsPerFile =
    fileCounts.length === 0 ? 0 : fileCounts.reduce((sum, value) => sum + value, 0) / fileCounts.length;
  const maxSymbolsPerFile = fileCounts.length === 0 ? 0 : Math.max(...fileCounts);

  const reasons: string[] = [];
  if (pivotCount === 0) reasons.push("no pivot symbol match");
  if (pivotCount > 0 && pivotCoverage < 0.8) reasons.push("pivot coverage below 80%");
  if (selectedNonPivots > 0 && dependencyCoverage < 0.35) {
    reasons.push("dependency coverage below 35%");
  }
  if (noiseRatio > 0.55) reasons.push("low-relevance content exceeds 55%");

  const coverageConfidence = computeCoverageConfidence({
    intent,
    pivotCount,
    pivotsIncluded,
    relevantPivotsIncluded,
    totalRelevantPivots: relevantPivotIds.size,
    dependencyCoverage,
    noiseRatio,
    fileSummaryCount: fileSummaries.length,
    moduleCoverageStats: {
      packedClusters: packedClusters.size,
      relevantClusters: relevantClusters.size,
      avgSymbolsPerFile,
      maxSymbolsPerFile,
    },
  });
  const confidenceFloor = intent === "narrow" ? 0.65 : 0.7;
  const uncertaintyFlag = reasons.length > 0 || coverageConfidence < confidenceFloor;
  if (coverageConfidence < confidenceFloor) {
    reasons.push(`overall coverage confidence below ${Math.round(confidenceFloor * 100)}%`);
  }
  const uncertainty = buildUncertainty(uncertaintyFlag, reasons.length, coverageConfidence);

  const uniqueFiles = new Set(packed.map((node) => node.file.path));
  const clusterGroupStats = new Map<number, { symbolCount: number; fileIds: Set<number> }>();
  for (const node of packed) {
    const clusterId = clusterBySymbolId.get(node.symbol.id);
    if (clusterId === undefined) continue;
    const existing = clusterGroupStats.get(clusterId) ?? { symbolCount: 0, fileIds: new Set<number>() };
    existing.symbolCount += 1;
    existing.fileIds.add(node.file.id);
    clusterGroupStats.set(clusterId, existing);
  }
  const clusterGroups = [...clusterGroupStats.entries()]
    .map(([id, stats]) => ({
      id,
      symbolCount: stats.symbolCount,
      fileCount: stats.fileIds.size,
    }))
    .sort((a, b) => b.symbolCount - a.symbolCount);

  const timeLimited = skipBfs || skipPromotion;

  const baseMetadata: CapsuleMetadata = {
    query,
    mode,
    tokenBudget,
    tokensUsed,
    symbolCount: packed.length,
    fileCount: uniqueFiles.size,
    compressionBreakdown,
    observationCount: observations.length,
    quality: {
      pivotCount,
      pivotsIncluded,
      pivotCoverage,
      dependencyCoverage,
      coverageConfidence,
      noiseRatio,
      uncertaintyFlag,
      lowConfidence: uncertaintyFlag,
      uncertainty,
      reasons,
      retrieval: {
        stageACandidateCount: rawPivotIds.size,
        stageBSelectedCount: selected.length,
      },
    },
    strategy: {
      intent,
      mode: useMultiPass ? "multi-pass" : "single-pass",
      subQueryCount: useMultiPass ? subQueries.length : 1,
    },
    ...(clusterGroups.length > 0 ? { clusterGroups } : {}),
    generatedAt: Date.now(),
    ...(timeLimited && { timeLimited: true }),
  };

  const metadata: CapsuleMetadata = {
    ...baseMetadata,
    diagnostics: diagnose(baseMetadata, pivotScores),
  };

  const content = formatCapsule(packed, observations, metadata, fileSummaries);

  logger.info("capsule generated", {
    symbolCount: packed.length,
    fileCount: uniqueFiles.size,
    tokensUsed,
    uncertainty,
  });
  const safeWrite = (label: string, fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      if (error instanceof Error && /SQLITE_BUSY/i.test(error.message)) {
        logger.debug("non-critical write skipped due to lock contention", { label });
        return;
      }
      throw error;
    }
  };

  safeWrite("observation", () => {
    captureQueryObservation(db, query, pivotSymbolIds, sessionId, params.projectRoot ?? "");
  });

  if (packed.length > 0) {
    safeWrite("session_context", () => {
      const symbolsToRecord = packed.map((node) => ({
        symbolId: node.symbol.id,
        fileId: node.symbol.fileId,
      }));
      sessionCtx.record(symbolsToRecord, query);
    });
  }

  safeWrite("capsule_log", () => {
    capsuleLogQueries(db).insert({
      sessionId,
      query,
      mode,
      tokenBudget,
      tokensUsed,
      symbolsIncluded: packed.map((n) => n.symbol.name),
      filesIncluded: [...uniqueFiles],
      timestamp: Date.now(),
      followedUp: false,
      missRatio: null,
      noiseRatio: metadata.quality.noiseRatio,
    });
  });

  return { content, metadata };
}
