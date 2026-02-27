import type Database from "better-sqlite3";
import { dirname, sep } from "node:path";
import type {
  CapsuleOutput,
  CapsuleMode,
  ScoredNode,
  CapsuleMetadata,
  CompressionLevel,
  CapsuleUncertainty,
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
import { rankPivots } from "./pivot-scorer.js";
import { renderSymbol } from "./compressor.js";
import { packNodes } from "./packer.js";
import { formatCapsule } from "./formatter.js";
import { createLogger } from "../utils/logger.js";
import { MemorySearch } from "../memory/search.js";
import { capsuleLogQueries } from "../db/queries/capsule-log.js";
import { sessionQueries } from "../db/queries/sessions.js";
import { captureQueryObservation } from "../memory/passive.js";
import { SessionContext } from "./session-context.js";
import { decomposeQuery, mergeSubQueryTerms } from "./query-decomposer.js";

const logger = createLogger("generator");

interface CapsuleParams {
  query: string;
  tokenBudget?: number;
  mode?: CapsuleMode;
  sessionId?: string;
  projectRoot?: string;
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

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))
  );
  return sorted[index] ?? 0;
}

function getCommonDisplayRoot(paths: string[]): string | null {
  if (paths.length === 0) return null;
  let prefix = dirname(paths[0]!);

  for (const path of paths.slice(1)) {
    while (prefix && path !== prefix && !path.startsWith(`${prefix}${sep}`)) {
      const next = dirname(prefix);
      if (next === prefix) {
        prefix = "";
        break;
      }
      prefix = next;
    }
    if (!prefix) return null;
  }

  return prefix || null;
}

function toDisplayPath(filePath: string, root: string | null): string {
  if (!root) return filePath.replaceAll("\\", "/");
  if (filePath === root) return filePath.replaceAll("\\", "/");
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!filePath.startsWith(rootWithSep)) return filePath.replaceAll("\\", "/");
  return filePath.slice(rootWithSep.length).replaceAll("\\", "/");
}

function getLexicalScore(
  symbol: LightSymbolRecord,
  file: FileRecord,
  queryTerms: string[],
  exactQueryTerms: Set<string>
): number {
  const symbolName = symbol.name.toLowerCase();
  const signature = symbol.signature.toLowerCase();
  const filePath = file.path.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    if (!term) continue;
    const termWeight = exactQueryTerms.has(term) ? 1 : 0.5;
    if (symbolName.includes(term)) {
      score += 2 * termWeight;
      continue;
    }
    if (signature.includes(term)) {
      score += 1.5 * termWeight;
      continue;
    }
    if (filePath.includes(term)) {
      score += 1 * termWeight;
    }
  }
  return score;
}

export interface ConfidenceParams {
  pivotCount: number;
  pivotsIncluded: number;
  relevantPivotsIncluded: number;
  totalRelevantPivots: number;
  dependencyCoverage: number;
  noiseRatio: number;
  fileSummaryCount: number;
}

export function computeCoverageConfidence(params: ConfidenceParams): number {
  const {
    pivotsIncluded,
    relevantPivotsIncluded,
    totalRelevantPivots,
    dependencyCoverage,
    noiseRatio,
    fileSummaryCount,
  } = params;

  const relevantCoverage =
    totalRelevantPivots === 0
      ? pivotsIncluded > 0
        ? 0.5
        : 0
      : relevantPivotsIncluded / totalRelevantPivots;

  const summaryBoost = Math.min(0.15, fileSummaryCount * 0.03);

  return Math.max(
    0,
    Math.min(
      1,
      relevantCoverage * 0.5 +
        dependencyCoverage * 0.2 +
        (1 - noiseRatio) * 0.15 +
        summaryBoost +
        0.15
    )
  );
}

function buildUncertainty(
  lowConfidence: boolean,
  reasonCount: number,
  coverageConfidence: number
): CapsuleUncertainty {
  if (!lowConfidence) return "low";
  if (reasonCount >= 2 || coverageConfidence < 0.45) return "high";
  return "medium";
}

export function generateCapsule(db: Database.Database, params: CapsuleParams): CapsuleOutput {
  const tokenBudget = params.tokenBudget ?? 4000;
  const mode = params.mode ?? "feature";
  const { query } = params;

  logger.info("generating capsule", { query, tokenBudget, mode });

  const symbols = symbolQueries(db);
  const files = fileQueries(db);

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
  const exactQueryTerms = queryGroups.length > 0
    ? mergeSubQueryTerms(queryGroups)
    : query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const expandedQueryTerms = expandQueryWithSynonyms(exactQueryTerms);
  const exactQueryTermSet = new Set(exactQueryTerms);
  const rawPivotIds = new Set<number>();

  for (const term of expandedQueryTerms) {
    if (term.length >= 3) {
      const ftsMatches = symbols.searchFTS(term, 15);
      for (const symbol of ftsMatches) rawPivotIds.add(symbol.id);
    } else {
      const matched = symbols.getByName(term);
      for (const symbol of matched) rawPivotIds.add(symbol.id);
    }

    const pathCandidates = getPathCandidates(term);
    const pathMatches = fuzzyMatch(term, pathCandidates, 0.4);
    for (const match of pathMatches.slice(0, 3)) {
      const file = pathCandidateCache.get(match.name);
      if (!file) continue;
      const fileSymbols = symbols.getByFileId(file.id);
      for (const symbol of fileSymbols) rawPivotIds.add(symbol.id);
    }
  }

  logger.debug("raw pivot candidates", { count: rawPivotIds.size });

  const MAX_PIVOTS = Math.max(30, Math.floor(tokenBudget / 50));
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

  const rankedPivots = rankPivots(pivotCandidates, exactQueryTerms, MAX_PIVOTS);

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

  logger.debug("pivot symbols after ranking", { raw: rawPivotIds.size, ranked: pivotSymbolIds.size });

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
  for (const id of pivotSymbolIds) {
    const symbol = symbols.getById(id);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;
    pivotFileIds.add(file.id);
    pivotDirs.add(dirname(file.path));
  }

  // Phase 2: Lazy BFS traversal keeps memory stable on large graphs.
  const maxDepth = getBfsDepth(tokenBudget);
  const scopeDirs = pivotDirs.size > 0 ? [...pivotDirs] : null;
  const bfsNodes = weightedBfsTraversal(db, [...pivotSymbolIds], maxDepth, scopeDirs);
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
    const sameDirAsPivot = pivotDirs.has(dirname(candidate.file.path));
    const directoryWeight = getDirectoryWeight(candidate.file.path);
    const localityBoost =
      (sameFileAsPivot ? 1.35 : sameDirAsPivot ? 1.15 : 1) * directoryWeight;
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
        const lexicalRelief = Math.min(0.4, candidate.lexicalScore * 0.1);
        hubPenalty = Math.max(0.25, 1 - hubPressure * 0.6 + lexicalRelief);
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
  const codeRatio = hasObservationPayload ? 0.8 : 1.0;

  const baseLexThreshold = exactQueryTerms.length === 0 ? 0 : 1;
  const baseCandidateLimit = Math.max(60, Math.floor(tokenBudget / 10));
  const MIN_UTILIZATION = 0.45;

  let selected = selectCandidates(baseLexThreshold, 1, baseCandidateLimit);
  let scoredNodes = buildScoredNodes(selected);
  let { packed, tokensUsed, fileSummaries } = packNodes(scoredNodes, tokenBudget, codeRatio);

  if (tokensUsed < tokenBudget * MIN_UTILIZATION && candidates.length > selected.length) {
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
      logger.debug("auto-expanded via promotion", { selectedCount: selected.length, tokensUsed });
    }
  }

  const relevanceLexicalThreshold = baseLexThreshold;

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
  const relevantPivotsIncluded = packed.filter((node) => rankedPivots.has(node.symbol.id)).length;

  const reasons: string[] = [];
  if (pivotCount === 0) reasons.push("no pivot symbol match");
  if (pivotCount > 0 && pivotCoverage < 0.8) reasons.push("pivot coverage below 80%");
  if (selectedNonPivots > 0 && dependencyCoverage < 0.35) {
    reasons.push("dependency coverage below 35%");
  }
  if (noiseRatio > 0.55) reasons.push("low-relevance content exceeds 55%");

  const coverageConfidence = computeCoverageConfidence({
    pivotCount,
    pivotsIncluded,
    relevantPivotsIncluded,
    totalRelevantPivots: rankedPivots.size,
    dependencyCoverage,
    noiseRatio,
    fileSummaryCount: fileSummaries.length,
  });
  const uncertaintyFlag = reasons.length > 0 || coverageConfidence < 0.65;
  if (coverageConfidence < 0.65) {
    reasons.push("overall coverage confidence below 65%");
  }
  const uncertainty = buildUncertainty(uncertaintyFlag, reasons.length, coverageConfidence);

  const uniqueFiles = new Set(packed.map((node) => node.file.path));

  const metadata: CapsuleMetadata = {
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
        stageACandidateCount: visited.size,
        stageBSelectedCount: selected.length,
      },
    },
    generatedAt: Date.now(),
  };

  const content = formatCapsule(packed, observations, metadata, fileSummaries);

  logger.info("capsule generated", {
    symbolCount: packed.length,
    fileCount: uniqueFiles.size,
    tokensUsed,
    uncertainty,
  });

  captureQueryObservation(db, query, pivotSymbolIds, sessionId, params.projectRoot ?? "");

  if (packed.length > 0) {
    const symbolsToRecord = packed.map((node) => ({
      symbolId: node.symbol.id,
      fileId: node.symbol.fileId,
    }));
    sessionCtx.record(symbolsToRecord, query);
  }

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

  return { content, metadata };
}
