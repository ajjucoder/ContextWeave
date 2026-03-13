import type Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { withinPath, globToRegExp, toProjectRelativePath } from "../mcp/tools/path-filters.js";
import type {
  CapsuleOutput,
  CapsuleMode,
  ScoredNode,
  CapsuleMetadata,
  CompressionLevel,
  LightSymbolRecord,
  FileRecord,
  EmbeddingRuntime,
  HybridSearchResult,
} from "../core/types.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { fileQueries } from "../db/queries/files.js";
import { getBatchSymbolDegrees, getDepthForBudget } from "../core/graph.js";
import { weightedBfsTraversal } from "../core/weighted-bfs.js";
import { fuzzyMatch } from "../utils/fuzzy.js";
import { countTokens, estimateTokens } from "../utils/tokens.js";
import { buildQueryCoverageGroups, expandQueryWithSynonyms } from "../utils/synonyms.js";
import { getDirectoryWeight } from "../utils/directory-weights.js";
import { isFrameworkEntryPath } from "../utils/path-retrieval.js";
import { scoreNode, assignCompressionLevel } from "./scorer.js";
import { rankPivotsWithScores, scorePivotRelevance } from "./pivot-scorer.js";
import { ACTION_SIGNAL_TERMS, UI_COMPONENT_PATH_RE, PAGE_ENTRY_PATH_RE } from "./signals.js";
import { renderSymbol, type EdgeSummary } from "./compressor.js";
import { packNodes, packNodesStoryMode, enrichL2WithDeps } from "./packer.js";
import { formatCapsule, buildStructuredOutput, selectObservations } from "./formatter.js";
import { diagnose } from "./diagnostics.js";
import { classifyQueryIntent } from "./intent-classifier.js";
import { getPatternsForFiles } from "../core/pattern-detector.js";
import { createLogger } from "../utils/logger.js";
import { MemorySearch } from "../memory/search.js";
import { capsuleLogQueries } from "../db/queries/capsule-log.js";
import { sessionQueries } from "../db/queries/sessions.js";
import { captureQueryObservation } from "../memory/passive.js";
import { ObservationStore } from "../memory/observations.js";
import { SessionContext } from "./session-context.js";
import {
  decomposeForBroad,
  decomposeForTask,
  decomposeQuery,
  decomposeTerms,
  mergeSubQueryTerms,
  type ClusterHint,
} from "./query-decomposer.js";
import { mergeSubCapsules, type SubCapsuleResult } from "./merger.js";
import { searchFilesByQuery } from "../core/file-summaries.js";
import { getFileClusterId, getClusterFileIds } from "../core/clusters.js";
import { buildUncertainty, computeCoverageConfidence } from "./confidence.js";
import { extractPathTerms, filePathMatchesQueryTerms, normalizeRetrievalPath } from "../utils/path-retrieval.js";
import { contentFallbackSearch } from "./content-fallback.js";
import { checkChainCoverage, type LayerCoverage } from "./chain-coverage.js";
import { getRetrievalLanes, getExpectedLayers, getLaneWeightForPath } from "../core/repo-profiler.js";
import {
  getCommonDisplayRoot,
  getLexicalScore,
  isTestFile,
  isTestQuery,
  quantile,
  toDisplayPath,
} from "./generator-helpers.js";
import { hybridSearch } from "../core/hybrid-ranker.js";

const logger = createLogger("generator");
export { computeCoverageConfidence } from "./confidence.js";

interface CapsuleParams {
  query: string;
  tokenBudget?: number;
  mode?: CapsuleMode;
  sessionId?: string;
  projectRoot?: string;
  maxQueryTimeMs?: number;
  path?: string;
  glob?: string;
  hybridSearchResults?: HybridSearchResult[];
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

const DEFAULT_TOKEN_BUDGET = 4000;
const DEFAULT_MAX_QUERY_TIME_MS = 500;
const NARROW_MIN_UTILIZATION = 0.45;
const BROAD_TASK_MIN_UTILIZATION = 0.6;
const BROAD_TASK_TARGET_UTILIZATION = 0.85;
const OBSERVATION_BUDGET_FRACTION = 0.2;
const MAX_BFS_VISITED_DIVISOR = 12;
const MAX_BFS_VISITED_CAP = 500;
const MAX_BFS_HOPS = 8;
const EDGE_BATCH_CHUNK_SIZE = 400;

const idfStmtCache = new WeakMap<Database.Database, ReturnType<Database.Database["prepare"]>>();
export function computeTermIDF(db: Database.Database, terms: string[]): Map<string, number> {
  const normalizedTerms = decomposeTerms(terms);
  if (normalizedTerms.length === 0) return new Map();

  const totalFiles = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
  if (totalFiles === 0) return new Map(normalizedTerms.map((term) => [term, 1]));

  let countStmt = idfStmtCache.get(db);
  if (!countStmt) {
    countStmt = db.prepare("SELECT COUNT(DISTINCT file_id) as c FROM symbols WHERE lower(name) LIKE '%' || ? || '%'");
    idfStmtCache.set(db, countStmt);
  }
  const weights = new Map<string, number>();
  for (const term of normalizedTerms) {
    const filesContaining = (countStmt.get(term) as { c: number }).c;
    weights.set(term, Math.log(totalFiles / (1 + filesContaining)));
  }
  return weights;
}

const obsHitStmtCache = new WeakMap<Database.Database, Database.Statement<[number, number]>>();
function recordObservationHits(db: Database.Database, observationIds: number[]): void {
  if (observationIds.length === 0) return;
  let stmt = obsHitStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare<[number, number]>("UPDATE observations SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?");
    obsHitStmtCache.set(db, stmt);
  }
  const now = Date.now();
  const s = stmt;
  db.transaction(() => {
    for (const id of observationIds) {
      s.run(now, id);
    }
  })();
}

interface CachedEdgeStmts {
  getDirectCallerIds: ReturnType<Database.Database["prepare"]>;
  getDirectCalleeIds: ReturnType<Database.Database["prepare"]>;
}
const edgeStmtCache = new WeakMap<Database.Database, CachedEdgeStmts>();
function getEdgeStmts(db: Database.Database): CachedEdgeStmts {
  const cached = edgeStmtCache.get(db);
  if (cached) return cached;
  const stmts: CachedEdgeStmts = {
    getDirectCallerIds: db.prepare(
      `SELECT source_symbol_id as symbolId FROM edges WHERE target_symbol_id = ? AND kind IN ('call', 'import', 'callback') LIMIT 12`
    ),
    getDirectCalleeIds: db.prepare(
      `SELECT target_symbol_id as symbolId FROM edges WHERE source_symbol_id = ? AND kind IN ('call', 'import', 'callback') LIMIT 12`
    ),
  };
  edgeStmtCache.set(db, stmts);
  return stmts;
}

const FRAMEWORK_QUERY_HINT_TERMS = new Set([
  "next",
  "nextjs",
  "middleware",
  "route",
  "routes",
  "handler",
  "page",
  "layout",
]);
const UI_FOCUSED_QUERY_TERMS = new Set([
  "ui",
  "ux",
  "component",
  "components",
  "view",
  "views",
  "page",
  "pages",
  "modal",
  "form",
]);
const TYPE_FOCUSED_TERMS = new Set([
  "type",
  "types",
  "interface",
  "interfaces",
  "dto",
  "dtos",
  "props",
  "declaration",
  "declarations",
  "generic",
  "generics",
  "typedef",
  "typedefs",
  "dts",
]);
const RUNTIME_QUERY_TERMS = new Set([
  "api",
  "auth",
  "callback",
  "compiler",
  "controller",
  "dispatch",
  "endpoint",
  "fetch",
  "flow",
  "handler",
  "hook",
  "hooks",
  "http",
  "lifecycle",
  "middleware",
  "pipeline",
  "request",
  "response",
  "route",
  "router",
  "routing",
  "runtime",
  "server",
  "service",
  "session",
  "stack",
  "validation",
  "validator",
]);
const TYPE_DECLARATION_PATH_RE = /(^|\/)types?(\/|$)|\.d\.ts$|(^|\/)types?\.[cm]?[jt]sx?$/i;
const RUNTIME_CODE_PATH_RE = /(^|\/)(src|lib|server|app|api|routes?|controllers?|services?)(\/|$)/i;

function getRuntimeKindWeight(
  kind: string,
  preferRuntimeKinds: boolean
): number {
  if (!preferRuntimeKinds) return 1;

  const normalizedKind = kind.toLowerCase();
  if (normalizedKind === "function" || normalizedKind === "method" || normalizedKind === "class") {
    return 1.08;
  }
  if (normalizedKind === "interface" || normalizedKind === "type") {
    return 0.72;
  }
  if (normalizedKind === "variable") {
    return 0.82;
  }
  return 1;
}

function getPivotKindWeight(
  kind: string,
  preferRuntimeKinds: boolean
): number {
  if (!preferRuntimeKinds) return 1;

  const normalizedKind = kind.toLowerCase();
  if (normalizedKind === "function" || normalizedKind === "method" || normalizedKind === "class") {
    return 1.08;
  }
  if (normalizedKind === "interface" || normalizedKind === "type") {
    return 0.7;
  }
  if (normalizedKind === "variable") {
    return 0.82;
  }
  return 1;
}

function hasActionSignal(name: string, signature: string): boolean {
  const tokens = `${name} ${signature}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.some((token) => ACTION_SIGNAL_TERMS.has(token));
}

function isUiLikePath(filePath: string): boolean {
  const normalizedPath = normalizeRetrievalPath(filePath, 6);
  return UI_COMPONENT_PATH_RE.test(normalizedPath) || PAGE_ENTRY_PATH_RE.test(normalizedPath);
}

function isTypeDeclarationPath(path: string): boolean {
  return TYPE_DECLARATION_PATH_RE.test(normalizeRetrievalPath(path, 6));
}

function isRuntimeCodePath(path: string): boolean {
  return RUNTIME_CODE_PATH_RE.test(normalizeRetrievalPath(path, 6));
}

function tokenizeCoverageTerms(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let idx = 0;
  while (idx < max && left[idx] === right[idx]) {
    idx += 1;
  }
  return idx;
}

function coverageTermsMatch(queryTerm: string, candidate: string): boolean {
  if (candidate === queryTerm) return true;
  if (queryTerm.length >= 5 && candidate.includes(queryTerm)) return true;
  if (candidate.length >= 5 && queryTerm.includes(candidate)) return true;

  const prefix = commonPrefixLength(queryTerm, candidate);
  const minPrefix = Math.min(queryTerm.length, candidate.length) >= 8 ? 5 : 4;
  return prefix >= minPrefix;
}

export function generateCapsule(db: Database.Database, params: CapsuleParams): CapsuleOutput {
  const tokenBudget = params.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const mode = params.mode ?? "feature";
  const { query } = params;
  const maxQueryTimeMs = params.maxQueryTimeMs ?? DEFAULT_MAX_QUERY_TIME_MS;
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  const isOverBudget = (fraction: number) => elapsed() > maxQueryTimeMs * fraction;

  logger.info("generating capsule", { query, tokenBudget, mode });

  const symbols = symbolQueries(db);
  const files = fileQueries(db);
  const { getDirectCallerIds, getDirectCalleeIds } = getEdgeStmts(db);
  const classified = classifyQueryIntent(query);
  const intent = classified.intent;
  // For pipeline routing, symbol-lookup and debug behave like narrow (focused retrieval)
  const retrievalBudget = Math.max(
    tokenBudget,
    Math.round(tokenBudget * classified.suggestedBudgetMultiplier)
  );

  const activeLanes = (intent === "broad" || intent === "task") && params.projectRoot
    ? getRetrievalLanes(db, params.projectRoot)
    : [];

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
  const fallbackTerms = queryGroups.groups.length > 0
    ? mergeSubQueryTerms(queryGroups.groups)
    : query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const intentTerms =
    intent === "task"
      ? (classified.focusTerms.length > 0 ? classified.focusTerms : classified.normalizedTerms)
      : classified.normalizedTerms;
  const baseQueryTerms = intentTerms.length > 0 ? intentTerms : fallbackTerms;
  const rawPivotIds = new Set<number>();
  const seededPivotIdsByFile = new Map<number, number[]>();

  const FILE_SEARCH_LIMIT = intent === "narrow" ? 50 : 80;
  let candidateFiles = searchFilesByQuery(db, query, FILE_SEARCH_LIMIT, params.projectRoot);
  const candidateFileBoostById = new Map<number, number>();
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
  const idfWeights = computeTermIDF(db, allQueryTerms);
  const pivotQueryTerms =
    intent === "narrow"
      ? exactQueryTerms
      : expandedQueryTerms;
  const memorySearch = new MemorySearch(db);
  const observationBudget = Math.floor(tokenBudget * OBSERVATION_BUDGET_FRACTION);
  const { observations } = memorySearch.getRelevantForCapsule(query, observationBudget);
  const typeFocusedQuery = allQueryTerms.some((term) => TYPE_FOCUSED_TERMS.has(term));
  const runtimeFocusedQuery = pivotQueryTerms.some((term) => RUNTIME_QUERY_TERMS.has(term));
  const hasRuntimeCandidateFile = candidateFiles.some((candidate) => isRuntimeCodePath(candidate.path));
  let suppressTypeDeclarations =
    intent !== "narrow" &&
    runtimeFocusedQuery &&
    !typeFocusedQuery &&
    hasRuntimeCandidateFile;
  if (suppressTypeDeclarations) {
    candidateFiles = candidateFiles.filter((candidate) => !isTypeDeclarationPath(candidate.path));
  }
  for (const [index, candidate] of candidateFiles.slice(0, intent === "broad" ? 20 : 16).entries()) {
    const boost = Math.max(1, 1.38 - index * 0.05);
    candidateFileBoostById.set(candidate.fileId, boost);
  }
  let candidateFileIds = candidateFiles.length > 0
    ? new Set(candidateFiles.map((f) => f.fileId))
    : null;
  if ((intent === "broad" || intent === "task") && candidateFileIds && candidateFileIds.size < 12) {
    candidateFileIds = null;
  }
  const preferRuntimeKinds = intent === "task" && candidateFiles.length > 0 && candidateFiles.length <= 6 && !typeFocusedQuery;
  const hybridSearchResults = params.hybridSearchResults ?? [];
  const hybridSearchEnabled = hybridSearchResults.length > 0;
  if (hybridSearchEnabled) {
    const hybridCandidateFiles = hybridSearchResults
      .map((result) => files.getById(result.fileId))
      .filter((file): file is FileRecord => file !== undefined);
    const seenHybridFiles = new Set<number>();
    const prioritizedHybridFiles = hybridCandidateFiles.filter((file) => {
      if (seenHybridFiles.has(file.id)) return false;
      seenHybridFiles.add(file.id);
      return true;
    }).map((file) => ({ fileId: file.id, path: file.path }));
    const lexicalTail = candidateFiles.filter((candidate) => !seenHybridFiles.has(candidate.fileId));
    candidateFiles = [...prioritizedHybridFiles, ...lexicalTail];
    for (const [index, result] of hybridSearchResults.entries()) {
      const exactBonus = result.exactMatchRank === 1 ? 0.45 : result.exactMatchRank != null ? 0.2 : 0;
      const boost = Math.max(1.05, 1.55 - index * 0.05 + exactBonus + Math.min(0.15, result.rrfScore));
      candidateFileBoostById.set(result.fileId, Math.max(candidateFileBoostById.get(result.fileId) ?? 1, boost));
      for (const symbolId of result.symbolIds.slice(0, intent === "broad" ? 4 : 6)) {
        rawPivotIds.add(symbolId);
        const existing = seededPivotIdsByFile.get(result.fileId) ?? [];
        if (!existing.includes(symbolId)) {
          existing.push(symbolId);
          seededPivotIdsByFile.set(result.fileId, existing);
        }
      }
    }

    // Phase 4.2: Graph expansion — walk edges from top hybrid results to find connected context
    if (intent !== "symbol-lookup") {
      const top10SymbolIds = [...rawPivotIds].slice(0, 10);
      const expansion: { symbolId: number; fileId: number }[] = [];
      const getConnectedSymbols = db.prepare(`
        SELECT s.id as symbolId, s.file_id as fileId FROM edges e
        JOIN symbols s ON (
          CASE WHEN e.source_symbol_id = ? THEN e.target_symbol_id ELSE e.source_symbol_id END = s.id
        )
        WHERE (e.source_symbol_id = ? OR e.target_symbol_id = ?)
          AND e.kind IN ('call', 'implements', 'type_usage', 'inheritance')
        LIMIT 6
      `);
      for (const symbolId of top10SymbolIds) {
        if (expansion.length >= 20) break;
        const rows = getConnectedSymbols.all(symbolId, symbolId, symbolId) as Array<{ symbolId: number; fileId: number }>;
        for (const row of rows) {
          if (!rawPivotIds.has(row.symbolId)) {
            expansion.push(row);
            if (expansion.length >= 20) break;
          }
        }
      }
      for (const { symbolId, fileId } of expansion) {
        rawPivotIds.add(symbolId);
        // Boost files that appear in graph expansion but weren't in hybrid results
        if (!candidateFileBoostById.has(fileId)) {
          candidateFileBoostById.set(fileId, 1.1);
        }
      }
    }
  }
  const exactQueryTermSet = new Set(exactQueryTerms);
  const queryLooksTestFocused = isTestQuery(allQueryTerms);
  const queryUiFocused = allQueryTerms.some((term) => UI_FOCUSED_QUERY_TERMS.has(term.toLowerCase()));
  const explicitTypeQuery = classified.normalizedTerms.some((term) => TYPE_FOCUSED_TERMS.has(term));

  if (candidateFileIds && candidateFileIds.size > 0 && candidateFileIds.size <= 6) {
    const MAX_CANDIDATE_FILES = 60;
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

  if (candidateFileIds && subQueries.length > 0 && candidateFileIds.size <= 20) {
    const MAX_SUBQUERY_CANDIDATE_FILES = 80;
    for (const subQuery of subQueries) {
      for (const clusterId of subQuery.targetClusterIds) {
        for (const fileId of getClusterFileIds(db, clusterId)) {
          if (candidateFileIds.size >= MAX_SUBQUERY_CANDIDATE_FILES) break;
          candidateFileIds.add(fileId);
        }
      }
    }
  }

  const perTermSymbolCap =
    intent === "narrow" ? 15 : intent === "broad" ? 10 : 12;
  const perTermPathMatchCap = intent === "narrow" ? 3 : 1;
  const pathFileSymbolCap = intent === "narrow" ? 10 : 6;
  const maxStageARaw =
    intent === "narrow"
      ? Number.POSITIVE_INFINITY
      : intent === "broad"
        ? Math.max(120, Math.floor(retrievalBudget / 140))
        : Math.max(160, Math.floor(retrievalBudget / 120));
  const memoryBridgeSymbolCap = intent === "narrow" ? 2 : 3;
  const memoryCandidateSymbolIds = new Set<number>();
  const selectMemorySeedSymbols = (fileId: number): number[] =>
    symbols
      .getByFileIdLight(fileId)
      .sort((a, b) => {
        if (a.isExported !== b.isExported) {
          return a.isExported ? -1 : 1;
        }
        if (b.centrality !== a.centrality) {
          return b.centrality - a.centrality;
        }
        return a.startLine - b.startLine;
      })
      .slice(0, memoryBridgeSymbolCap)
      .map((symbol) => symbol.id);

  for (const observation of observations) {
    if (observation.symbolId != null) {
      memoryCandidateSymbolIds.add(observation.symbolId);
    }
    if (observation.fileId != null) {
      for (const symbolId of selectMemorySeedSymbols(observation.fileId)) {
        memoryCandidateSymbolIds.add(symbolId);
      }
    }
  }

  if (intent !== "narrow" && candidateFiles.length > 0) {
    const seedFileLimit = intent === "broad" ? 6 : 8;
    const seedSymbolsPerFile = intent === "broad" ? 2 : 3;
    for (const candidate of candidateFiles.slice(0, seedFileLimit)) {
      if (rawPivotIds.size >= maxStageARaw) break;
      const fileSymbols = symbols
        .getByFileIdLight(candidate.fileId)
        .map((symbol) => ({
          symbol,
          score: scorePivotRelevance(
            {
              name: symbol.name,
              signature: symbol.signature,
              kind: symbol.kind,
              filePath: files.getById(candidate.fileId)?.path ?? "",
            },
            pivotQueryTerms
          ),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if (a.symbol.isExported !== b.symbol.isExported) {
            return a.symbol.isExported ? -1 : 1;
          }
          if (b.symbol.centrality !== a.symbol.centrality) {
            return b.symbol.centrality - a.symbol.centrality;
          }
          return a.symbol.startLine - b.symbol.startLine;
        })
        .slice(0, seedSymbolsPerFile);
      for (const entry of fileSymbols) {
        rawPivotIds.add(entry.symbol.id);
        const existing = seededPivotIdsByFile.get(candidate.fileId) ?? [];
        existing.push(entry.symbol.id);
        seededPivotIdsByFile.set(candidate.fileId, existing);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
    }
  }

  for (const term of expandedQueryTerms) {
    if (rawPivotIds.size >= maxStageARaw) break;

    // Phase 1: exact case-insensitive name match
    const EXACT_MATCH_THRESHOLD = 3;
    const exactMatches = symbols.getByNameCI(term);
    const exactFiltered = candidateFileIds
      ? exactMatches.filter((s) => candidateFileIds.has(s.fileId))
      : exactMatches;
    for (const symbol of exactFiltered.slice(0, perTermSymbolCap)) {
      rawPivotIds.add(symbol.id);
      if (rawPivotIds.size >= maxStageARaw) break;
    }

    // Phase 2: FTS — only if exact match didn't find enough results
    if (exactFiltered.length < EXACT_MATCH_THRESHOLD && term.length >= 3) {
      const ftsMatches = symbols.searchFTS(term, perTermSymbolCap);
      const filtered = candidateFileIds
        ? ftsMatches.filter((s) => candidateFileIds.has(s.fileId))
        : ftsMatches;
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
      const fileSymbols = symbols.getByFileIdLight(file.id);
      for (const symbol of fileSymbols.slice(0, pathFileSymbolCap)) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
      if (rawPivotIds.size >= maxStageARaw) break;
    }
  }

  if (
    intent !== "narrow" &&
    rawPivotIds.size < maxStageARaw &&
    allQueryTerms.some((term) => FRAMEWORK_QUERY_HINT_TERMS.has(term))
  ) {
    const hintPaths = new Set<string>();
    for (const hint of ["middleware", "route", "page", "layout"]) {
      for (const filePath of getPathCandidates(hint)) {
        hintPaths.add(filePath);
      }
    }

    for (const filePath of hintPaths) {
      if (!isFrameworkEntryPath(filePath)) continue;
      const file = pathCandidateCache.get(filePath);
      if (!file) continue;
      if (candidateFileIds && !candidateFileIds.has(file.id)) continue;
      for (const symbol of symbols.getByFileIdLight(file.id).slice(0, 6)) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
      if (rawPivotIds.size >= maxStageARaw) break;
    }
  }

  // Path-segment coverage pass: catches route/feature files missed by FTS symbol search.
  // e.g. "api/submit-inquiry/route.ts" found by query term "inquiry" (7 chars).
  // Only runs for task/broad intent (narrow symbol queries already work via FTS).
  // Only adds files that have NO symbols already in rawPivotIds ("orphaned" files).
  if (intent !== "narrow" && rawPivotIds.size < maxStageARaw && pathCandidateCache.size > 0) {
    const coveredFileIds = new Set<number>();
    for (const id of rawPivotIds) {
      const sym = symbols.getByIdLight(id);
      if (sym) coveredFileIds.add(sym.fileId);
    }
    for (const [filePath, file] of pathCandidateCache) {
      if (rawPivotIds.size >= maxStageARaw) break;
      if (coveredFileIds.has(file.id)) continue;
      if (!filePathMatchesQueryTerms(filePath, exactQueryTerms)) continue;
      const fileSymbols = symbols.getByFileIdLight(file.id);
      for (const symbol of fileSymbols.slice(0, pathFileSymbolCap)) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
    }
  }

  const MAX_PIVOTS =
    intent === "narrow"
      ? Math.max(30, Math.min(120, Math.floor(retrievalBudget / 50)))
      : intent === "broad"
        ? Math.max(40, Math.min(100, Math.floor(retrievalBudget / 160)))
        : Math.max(50, Math.min(120, Math.floor(retrievalBudget / 150)));
  const pivotFileCache = new Map<number, string>();
  const buildPivotCandidates = (
    candidateIds: Iterable<number>
  ): Array<{ id: number; name: string; signature: string; kind: string; filePath: string }> => {
    const candidates: Array<{ id: number; name: string; signature: string; kind: string; filePath: string }> = [];
    for (const id of candidateIds) {
      const sym = symbols.getByIdLight(id);
      if (!sym) continue;
      let filePath = pivotFileCache.get(sym.fileId);
      if (filePath === undefined) {
        const file = files.getById(sym.fileId);
        filePath = file?.path ?? "";
        pivotFileCache.set(sym.fileId, filePath);
      }
      if (suppressTypeDeclarations && isTypeDeclarationPath(filePath)) {
        continue;
      }
      candidates.push({ id, name: sym.name, signature: sym.signature ?? "", kind: sym.kind, filePath });
    }
    return candidates;
  };
  const isExactSymbolNameMatch = (name: string): boolean => {
    const nameLower = name.toLowerCase();
    if (exactQueryTermSet.has(nameLower)) return true;
    const nameTokens = name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[_\-./]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    return nameTokens.length > 1 && nameTokens.every((token) => exactQueryTermSet.has(token));
  };

  if (rawPivotIds.size < 3 && !hybridSearchEnabled) {
    const preFallbackCandidates = buildPivotCandidates(rawPivotIds);
    const preFallbackRanking = rankPivotsWithScores(
      preFallbackCandidates,
      exactQueryTerms.length > 0 ? exactQueryTerms : pivotQueryTerms,
      MAX_PIVOTS,
      idfWeights
    );
    const exactPivotIds = new Set(
      preFallbackCandidates
        .filter((candidate) => isExactSymbolNameMatch(candidate.name))
        .map((candidate) => candidate.id)
    );
    const exactPivot = preFallbackRanking.scored.find((entry) => exactPivotIds.has(entry.id));

    if (exactPivot) {
      let added = 0;
      const relatedRows = [
        ...(getDirectCallerIds.all(exactPivot.id) as Array<{ symbolId: number }>),
        ...(getDirectCalleeIds.all(exactPivot.id) as Array<{ symbolId: number }>),
      ];

      for (const row of relatedRows) {
        if (!rawPivotIds.has(row.symbolId)) {
          rawPivotIds.add(row.symbolId);
          added += 1;
        }
      }

      logger.info("exact match fast path activated", {
        symbolId: exactPivot.id,
        addedRelations: added,
        totalPivots: rawPivotIds.size,
      });
    } else {
      const contentMatches = contentFallbackSearch(db, expandedQueryTerms);
      let added = 0;
      for (const match of contentMatches) {
        if (suppressTypeDeclarations) {
          const symbol = symbols.getByIdLight(match.symbolId);
          const file = symbol ? files.getById(symbol.fileId) : null;
          if (file && isTypeDeclarationPath(file.path)) {
            continue;
          }
        }
        if (!rawPivotIds.has(match.symbolId)) {
          rawPivotIds.add(match.symbolId);
          added++;
        }
      }
      if (added > 0) {
        logger.info("content fallback activated", { additionalPivots: added, totalPivots: rawPivotIds.size });
      }
    }
  }

  if (rawPivotIds.size < 3 && memoryCandidateSymbolIds.size > 0) {
    let added = 0;
    for (const symbolId of memoryCandidateSymbolIds) {
      const symbol = symbols.getByIdLight(symbolId);
      if (!symbol) continue;
      const file = files.getById(symbol.fileId);
      if (!file) continue;
      if (suppressTypeDeclarations && isTypeDeclarationPath(file.path)) continue;
      rawPivotIds.add(symbolId);
      added += 1;
      if (rawPivotIds.size >= maxStageARaw) break;
    }
    if (added > 0) {
      logger.info("memory bridge activated", { addedPivots: added, totalPivots: rawPivotIds.size });
    }
  }

  logger.debug("raw pivot candidates", { count: rawPivotIds.size });

  let pivotCandidates = buildPivotCandidates(rawPivotIds);
  if (
    !suppressTypeDeclarations &&
    intent !== "narrow" &&
    runtimeFocusedQuery &&
    !typeFocusedQuery &&
    pivotCandidates.some((candidate) => isRuntimeCodePath(candidate.filePath))
  ) {
    suppressTypeDeclarations = true;
    pivotCandidates = pivotCandidates.filter((candidate) => !isTypeDeclarationPath(candidate.filePath));
  }

  const pivotRanking = rankPivotsWithScores(
    pivotCandidates,
    pivotQueryTerms,
    MAX_PIVOTS,
    idfWeights
  );
  let rankedPivots = pivotRanking.ranked;
  let pivotScores = pivotRanking.scores;
  const exactPivotIds = new Set(
    pivotCandidates
      .filter((candidate) => isExactSymbolNameMatch(candidate.name))
      .map((candidate) => candidate.id)
  );

  if (intent !== "narrow" && rankedPivots.size > 0) {
    const pivotKinds = new Map(pivotCandidates.map((candidate) => [candidate.id, candidate.kind]));
    const adjustedEntries = [...rankedPivots.entries()]
      .map(([id, score]) => [
        id,
        score * getPivotKindWeight(pivotKinds.get(id) ?? "", preferRuntimeKinds),
      ] as const)
      .sort((a, b) => b[1] - a[1]);
    rankedPivots = new Map(adjustedEntries);
    pivotScores = adjustedEntries.map(([, score]) => score);
  }

  if (intent !== "narrow" && candidateFiles.length > 0) {
    const rankedEntries = [...rankedPivots.entries()].sort((a, b) => b[1] - a[1]);
    const topScore = rankedEntries[0]?.[1] ?? 1;
    const fallbackSeedScore = Math.max(0.75, topScore * 0.32);
    const maxSeedFiles = intent === "broad" ? 3 : 4;
    let injected = 0;

    for (const candidate of candidateFiles) {
      if (injected >= maxSeedFiles) break;
      if (isTestFile(candidate.path)) continue;

      const seedIds = seededPivotIdsByFile.get(candidate.fileId) ?? [];
      const seedId = seedIds.find((id) => !rankedPivots.has(id));
      if (seedId === undefined) continue;

      const boost = candidateFileBoostById.get(candidate.fileId) ?? 1;
      rankedPivots.set(seedId, fallbackSeedScore * Math.min(boost, 1.35));
      injected += 1;
    }
    pivotScores = [...rankedPivots.values()].sort((a, b) => b - a);
  }

  if (rankedPivots.size < 3 && memoryCandidateSymbolIds.size > 0) {
    const topScore = [...rankedPivots.values()].sort((a, b) => b - a)[0] ?? 0;
    const memoryFallbackScore = topScore > 0 ? Math.max(0.9, topScore * 0.42) : 1.1;
    for (const symbolId of memoryCandidateSymbolIds) {
      if (rankedPivots.has(symbolId)) continue;
      const candidate = pivotCandidates.find((entry) => entry.id === symbolId);
      if (!candidate) continue;
      rankedPivots.set(symbolId, memoryFallbackScore * getPivotKindWeight(candidate.kind, preferRuntimeKinds));
    }
    pivotScores = [...rankedPivots.values()].sort((a, b) => b - a);
  }

  if (intent !== "narrow" && rankedPivots.size > 0) {
    const rankedEntries = [...rankedPivots.entries()].sort((a, b) => b[1] - a[1]);
    const topScore = rankedEntries[0]?.[1] ?? 0;
    const pivotFloor = topScore * (intent === "broad" ? 0.22 : 0.18);
    const guaranteedPivots = intent === "broad" ? 4 : 5;
    const maxPrimaryPivots = intent === "broad" ? 12 : 14;

    const filteredEntries = rankedEntries.filter(([, score], index) =>
      index < guaranteedPivots || (index < maxPrimaryPivots && score >= pivotFloor)
    );

    rankedPivots = new Map(filteredEntries);
    pivotScores = filteredEntries.map(([, score]) => score);
  }

  const SINGLE_IDENTIFIER_RE = /^[a-zA-Z_]\w*$/;
  const queryLower = query.toLowerCase();
  const symbolNotFound =
    SINGLE_IDENTIFIER_RE.test(query) &&
    pivotCandidates.every((candidate) => candidate.name.toLowerCase() !== queryLower);

  const sessionId = params.sessionId?.trim();
  const hasExplicitSession = typeof sessionId === "string" && sessionId.length > 0;
  const sessionCtx = hasExplicitSession ? new SessionContext(db, sessionId) : null;

  if (hasExplicitSession) {
    sessionQueries(db).ensureSession(sessionId, params.projectRoot ?? "");
  }

  const previousSameQueryTokens = hasExplicitSession
    ? capsuleLogQueries(db)
        .getBySessionAndQuery(sessionId, query)
        ?.tokensUsed ?? null
    : null;

  const recentFileIds = new Set(sessionCtx?.getRecentFileIds() ?? []);
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

  // Build symbol/file → observation count maps so scoreNode can use durable memory signals.
  const observationCountBySymbol = new Map<number, number>();
  const observationCountByFile = new Map<number, number>();
  for (const obs of observations) {
    if (obs.symbolId != null) {
      observationCountBySymbol.set(obs.symbolId, (observationCountBySymbol.get(obs.symbolId) ?? 0) + 1);
    }
    if (obs.fileId != null) {
      observationCountByFile.set(obs.fileId, (observationCountByFile.get(obs.fileId) ?? 0) + 1);
    }
  }

  const fileCache = new Map<number, FileRecord | undefined>();
  const getFile = (fileId: number): FileRecord | undefined => {
    if (!fileCache.has(fileId)) fileCache.set(fileId, files.getById(fileId));
    return fileCache.get(fileId);
  };

  const pivotFileIds = new Set<number>();
  const pivotDirs = new Set<string>();
  const localityPivotDirs = new Set<string>();
  for (const id of pivotSymbolIds) {
    const symbol = symbols.getByIdLight(id);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;
    const normalizedPath = normalizeRetrievalPath(file.path, 6);
    pivotFileIds.add(file.id);
    pivotDirs.add(dirname(normalizedPath));
    if (topLocalityPivotIds.has(id)) {
      localityPivotDirs.add(dirname(normalizedPath));
    }
  }

  // Phase 2: Lazy BFS traversal keeps memory stable on large graphs.
  const skipBfs = isOverBudget(0.5);
  const baseDepth = getDepthForBudget(retrievalBudget);
  const hasExactPivot = exactPivotIds.size > 0;
  const maxDepth =
    intent === "broad"
      ? Math.max(2, baseDepth - 1)
      : intent === "task"
        ? Math.min(6, baseDepth)
        : intent === "symbol-lookup"
          ? (hasExactPivot ? 2 : Math.min(3, baseDepth))
          : (hasExactPivot && intent === "narrow" ? Math.min(baseDepth, 3) : baseDepth);
  const rankingPivotDirs =
    intent === "broad"
      ? pivotDirs
      : intent === "narrow" || localityPivotDirs.size === 0
      ? pivotDirs
      : localityPivotDirs;
  const scopeDirSet = new Set<string>(rankingPivotDirs);
  if (intent === "task") {
    for (const dir of impliedModuleDirs) {
      scopeDirSet.add(dir);
    }
  }
  const scopeDirs = scopeDirSet.size > 0 ? [...scopeDirSet] : null;
  const maxVisitedBase = Math.min(MAX_BFS_VISITED_CAP, Math.floor(retrievalBudget / MAX_BFS_VISITED_DIVISOR));
  const maxVisitedNodes = intent === "symbol-lookup" && hasExactPivot
    ? Math.min(maxVisitedBase, 30)
    : maxVisitedBase;
  const effectiveBfsDepth = skipBfs ? 1 : maxDepth;
  const bfsIncomingMult = intent === "broad" ? 4.0 : 1.5;
  const bfsNodes = weightedBfsTraversal(db, [...pivotSymbolIds], effectiveBfsDepth, scopeDirs, { maxVisitedNodes, maxHops: MAX_BFS_HOPS, incomingEdgeCostMultiplier: bfsIncomingMult });
  const visited = new Map<number, number>(bfsNodes.map((n) => [n.symbolId, n.distance]));

  logger.debug("bfs traversal complete", { nodesVisited: visited.size });

  // Build path/glob restriction set if requested
  const pathGlobRegex = params.glob ? globToRegExp(params.glob) : null;
  const scopePath = params.path?.trim() ?? null;
  const resolvedProjectRoot = params.projectRoot ? resolve(params.projectRoot) : null;
  const hasPathRestriction = pathGlobRegex !== null || scopePath !== null;

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
    if (suppressTypeDeclarations && isTypeDeclarationPath(file.path)) continue;

    if (hasPathRestriction) {
      const relPath = resolvedProjectRoot ? toProjectRelativePath(resolvedProjectRoot, file.path) : file.path;
      if (scopePath && !withinPath(relPath, scopePath)) continue;
      if (pathGlobRegex && !pathGlobRegex.test(relPath)) continue;
    }

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

  const isNoisyTestFile = (filePath: string): boolean => {
    if (isTestFile(filePath)) return true;
    const lower = filePath.toLowerCase().replaceAll("\\", "/");
    return lower.includes("/mock") || lower.includes("/fixture") || lower.includes("/__mocks__/") || lower.includes("/fixtures/");
  };

  for (const candidate of candidates) {
    const sameFileAsPivot = pivotFileIds.has(candidate.file.id);
    const normalizedPath = normalizeRetrievalPath(candidate.file.path, 6);
    const sameDirAsPivot = rankingPivotDirs.has(dirname(normalizedPath));
    const directoryWeight = getDirectoryWeight(normalizedPath, params.projectRoot);
    const laneWeight = activeLanes.length > 0 ? getLaneWeightForPath(activeLanes, candidate.file.path) : 1;
    const fileSearchBoost = candidateFileBoostById.get(candidate.file.id) ?? 1;
    const actionSignal = hasActionSignal(candidate.symbol.name, candidate.symbol.signature);
    const uiPathPenalty =
      !queryUiFocused &&
      (intent === "broad" || intent === "task" || intent === "debug") &&
      isUiLikePath(normalizedPath)
        ? actionSignal ? 0.82 : 0.58
        : 1;
    const testFilePenalty =
      !queryLooksTestFocused && mode !== "debug" && isNoisyTestFile(candidate.file.path) ? 0.3 : 1;
    const localityBoost =
      (sameFileAsPivot ? 1.35 : sameDirAsPivot ? 1.2 : 1) *
      directoryWeight *
      laneWeight *
      uiPathPenalty *
      testFilePenalty *
      fileSearchBoost;
    const lexicalBoost = 1 + Math.min(1.5, candidate.lexicalScore * 0.3);
    const exactPivotBoost = exactPivotIds.has(candidate.symbol.id) ? 6 : 1;

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
      observationCount:
        (observationCountBySymbol.get(candidate.symbol.id) ?? 0) +
        (observationCountByFile.get(candidate.symbol.fileId) ?? 0),
      isExported: candidate.symbol.isExported,
      isPivot: candidate.isPivot,
      lexicalBoost,
      localityBoost,
      hubPenalty,
      mode,
    }) * getRuntimeKindWeight(candidate.symbol.kind, preferRuntimeKinds) * exactPivotBoost;

    if (mode !== "debug" && candidate.lexicalScore === 0 && candidate.distance > 1) {
      candidate.score *= 0.4;
    }

    if (mode !== "debug" && candidate.distance > 0 && !queryLooksTestFocused && isNoisyTestFile(candidate.file.path)) {
      candidate.score *= 0.3;
    }
  }

  let ranked = [...candidates].sort((a, b) => b.score - a.score);

  function filterCandidatesBySymbolRelevance(candidates: RankedCandidate[]): RankedCandidate[] {
    if (intent === "broad" || allQueryTerms.length === 0 || candidates.length === 0) {
      return candidates;
    }
    const queryTermSet = new Set(allQueryTerms.map((t) => t.toLowerCase()));
    const topScore = candidates[0]?.score ?? 0;
    return candidates.filter((candidate) => {
      if (candidate.distance === 0) return true;
      if (candidate.distance === 1) return true;
      const nameTokens = tokenizeCoverageTerms(candidate.symbol.name);
      const sigTokens = tokenizeCoverageTerms(candidate.symbol.signature ?? "");
      const hasQueryOverlap = [...nameTokens, ...sigTokens].some((t) => queryTermSet.has(t));
      const hasHighScore = topScore > 0 && candidate.score >= topScore * 0.35;
      return hasQueryOverlap || hasHighScore;
    });
  }

  ranked = filterCandidatesBySymbolRelevance(ranked);

  const hybridStrategy = {
    enabled: hybridSearchEnabled,
    applied: hybridSearchEnabled,
    candidateCount: hybridSearchResults.length,
    exactMatches: hybridSearchResults.filter((result) => result.exactMatchRank !== null).length,
  };

  function hasStrongLocality(candidate: RankedCandidate): boolean {
    if (pivotFileIds.has(candidate.file.id)) return true;
    if (!rankingPivotDirs.has(dirname(normalizeRetrievalPath(candidate.file.path, 6)))) return false;
    const dirDistanceCap = intent === "narrow" ? 2 : 1;
    return candidate.distance <= dirDistanceCap;
  }

  function selectCandidates(lexThreshold: number, maxDist: number, limit: number): RankedCandidate[] {
    const ids = new Set<number>();
    const result: RankedCandidate[] = [];

    for (const candidate of ranked) {
      if (!candidate.isPivot) continue;
      const preservePivot =
        intent === "narrow" ||
        intent === "symbol-lookup" ||
        queryUiFocused ||
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
      if (intent === "narrow") {
        if (!hasLexical && !isNearby) continue;
        const overlap = computeQueryOverlap(candidate.symbol.name);
        if (overlap === 0 && !hasDirectEdgeToPivot(candidate.symbol.id)) continue;
      } else {
        const strongLocality = hasStrongLocality(candidate);
        if (!(strongLocality || (hasLexical && isNearby))) continue;
      }
      result.push(candidate);
      ids.add(candidate.symbol.id);
    }

    return result;
  }

  function pruneByFileDiversity(selectedCandidates: RankedCandidate[]): RankedCandidate[] {
    if (selectedCandidates.length === 0) {
      return selectedCandidates;
    }

    const isNarrowMultiTerm = intent === "narrow" && exactQueryTerms.length >= 3;
    const broadBudgetBoost = intent === "broad" && tokenBudget >= 8000;
    if (intent === "narrow" && !isNarrowMultiTerm) {
      return selectedCandidates;
    }

    const maxFiles = isNarrowMultiTerm ? 4 : intent === "broad" ? (broadBudgetBoost ? 12 : 10) : 7;
    const maxPerFile = isNarrowMultiTerm ? 4 : intent === "broad" ? (broadBudgetBoost ? 5 : 3) : 4;
    const maxTotal = isNarrowMultiTerm ? 20 : intent === "broad" ? (broadBudgetBoost ? 56 : 35) : 24;
    const lexicalFloor = isNarrowMultiTerm ? 2 : intent === "broad" ? (broadBudgetBoost ? 0.9 : 1.5) : 1.2;
    const ordered = [...selectedCandidates].sort((a, b) => {
      if (a.isPivot !== b.isPivot) return a.isPivot ? -1 : 1;
      return b.score - a.score;
    });
    const topScore = ordered[0]?.score ?? 0;
    const scoreFloor = topScore * (isNarrowMultiTerm ? 0.7 : intent === "broad" ? (broadBudgetBoost ? 0.4 : 0.6) : 0.55);

    const kept: RankedCandidate[] = [];
    const includedFiles = new Set<number>();
    const perFileCount = new Map<number, number>();

    for (const candidate of ordered) {
      if (kept.length >= maxTotal) break;
      const fileId = candidate.file.id;
      const existingCount = perFileCount.get(fileId) ?? 0;
      const introducesFile = !includedFiles.has(fileId);
      const strongLocality = hasStrongLocality(candidate);

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

  function pruneUiNoise(selectedCandidates: RankedCandidate[]): RankedCandidate[] {
    if (
      queryUiFocused ||
      !(intent === "broad" || intent === "task" || intent === "debug") ||
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

  function ensureBroadFileSpread(selectedCandidates: RankedCandidate[]): RankedCandidate[] {
    if (intent !== "broad" || tokenBudget < 4000 || selectedCandidates.length === 0) {
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
      if (!queryUiFocused && isUiLikePath(candidate.file.path) && !hasActionSignal(candidate.symbol.name, candidate.symbol.signature)) {
        return false;
      }
      augmented.push(candidate);
      selectedIds.add(candidate.symbol.id);
      selectedFileIds.add(candidate.file.id);
      return selectedFileIds.size >= 3;
    };

    for (const candidate of ranked) {
      const relevant = hasStrongLocality(candidate) || candidate.lexicalScore > 0;
      if (!relevant) continue;
      if (maybeAddCandidate(candidate)) return augmented;
    }

    for (const candidate of ranked) {
      if (maybeAddCandidate(candidate)) return augmented;
    }

    const selectedDirs = new Set(augmented.map((candidate) => dirname(candidate.file.path)));
    for (const file of files.iterateAll()) {
      if (selectedFileIds.has(file.id) || !selectedDirs.has(dirname(file.path))) {
        continue;
      }
      if (!queryUiFocused && isUiLikePath(file.path)) {
        continue;
      }

      const bestSymbol = symbols
        .getByFileIdLight(file.id)
        .map((symbol) => ({
          symbol,
          lexicalScore: scorePivotRelevance(
            {
              name: symbol.name,
              signature: symbol.signature,
              kind: symbol.kind,
              filePath: file.path,
            },
            pivotQueryTerms
          ),
        }))
        .sort((a, b) => {
          if (a.symbol.isExported !== b.symbol.isExported) {
            return a.symbol.isExported ? -1 : 1;
          }
          if (b.lexicalScore !== a.lexicalScore) {
            return b.lexicalScore - a.lexicalScore;
          }
          return b.symbol.centrality - a.symbol.centrality;
        })[0];

      if (!bestSymbol) continue;
      if (
        !queryUiFocused &&
        isUiLikePath(file.path) &&
        !hasActionSignal(bestSymbol.symbol.name, bestSymbol.symbol.signature)
      ) {
        continue;
      }

      if (visited.has(bestSymbol.symbol.id)) continue;
      augmented.push({
        symbol: bestSymbol.symbol,
        file,
        score: computeQueryOverlap(bestSymbol.symbol.name) * 6 + bestSymbol.lexicalScore * 5 + bestSymbol.symbol.centrality * 1 + 0.25,
        distance: 2,
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

  function tokenizeSymbolName(name: string): string[] {
    return name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[_\-./]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  function computeQueryOverlap(symbolName: string): number {
    const nameTokens = new Set(tokenizeSymbolName(symbolName));
    const queryTermSet = new Set(pivotQueryTerms.map((t) => t.toLowerCase()));
    let overlap = 0;
    for (const token of nameTokens) {
      if (queryTermSet.has(token)) overlap++;
    }
    return overlap;
  }

  function hasDirectEdgeToPivot(symbolId: number): boolean {
    const callers = getDirectCallerIds.all(symbolId) as Array<{ symbolId: number }>;
    for (const row of callers) {
      if (pivotSymbolIds.has(row.symbolId)) return true;
    }
    const callees = getDirectCalleeIds.all(symbolId) as Array<{ symbolId: number }>;
    for (const row of callees) {
      if (pivotSymbolIds.has(row.symbolId)) return true;
    }
    return false;
  }

  function backfillWithinSelectedFiles(selectedCandidates: RankedCandidate[]): RankedCandidate[] {
    if (intent !== "broad" || tokenBudget < 4000 || selectedCandidates.length >= 10) {
      return selectedCandidates;
    }

    const applyTestFilePenalty = mode === "review" || mode === "feature";

    const selectedIds = new Set<number>(selectedCandidates.map((candidate) => candidate.symbol.id));
    const selectedFileIds = new Set<number>(selectedCandidates.map((candidate) => candidate.file.id));
    if (selectedFileIds.size === 0) {
      return selectedCandidates;
    }

    const scoreBackfillCandidate = (
      symbol: LightSymbolRecord,
      lexicalScore: number,
      filePath: string
    ): number => {
      const queryOverlap = computeQueryOverlap(symbol.name);
      let score = queryOverlap * 6 + lexicalScore * 1.5 + symbol.centrality * 2 + 0.25;
      if (applyTestFilePenalty && isTestFile(filePath)) {
        score *= 0.3;
      }
      return score;
    };

    const rankedExtras = ranked.filter(
      (candidate) =>
        !selectedIds.has(candidate.symbol.id) &&
        selectedFileIds.has(candidate.file.id) &&
        candidate.distance <= 2
    );

    const extras: RankedCandidate[] = [];
    for (const candidate of rankedExtras) {
      const queryOverlap = computeQueryOverlap(candidate.symbol.name);
      if (queryOverlap === 0 && !hasDirectEdgeToPivot(candidate.symbol.id)) continue;
      const filePath = candidate.file.path;
      const score = scoreBackfillCandidate(candidate.symbol, candidate.lexicalScore, filePath);
      extras.push({ ...candidate, score });
    }

    const extraIds = new Set<number>(extras.map((candidate) => candidate.symbol.id));

    if (selectedCandidates.length + extras.length < 10) {
      for (const fileId of selectedFileIds) {
        const file = getFile(fileId);
        if (!file) continue;
        const fallbackFilePath = file.path || files.getById(fileId)?.path || "";
        if (!fallbackFilePath) continue;
        for (const symbol of symbols.getByFileIdLight(fileId)) {
          if (selectedIds.has(symbol.id) || extraIds.has(symbol.id)) {
            continue;
          }
          const queryOverlap = computeQueryOverlap(symbol.name);
          if (queryOverlap === 0 && !hasDirectEdgeToPivot(symbol.id)) continue;
          const lexicalScore = scorePivotRelevance(
            {
              name: symbol.name,
              signature: symbol.signature,
              kind: symbol.kind,
              filePath: files.getById(symbol.fileId)?.path || fallbackFilePath,
            },
            pivotQueryTerms
          );
          const score = scoreBackfillCandidate(symbol, lexicalScore, fallbackFilePath);
          extras.push({
            symbol,
            file,
            score,
            distance: 2,
            isPivot: false,
            lexicalScore,
            degree: 0,
          });
          extraIds.add(symbol.id);
        }
      }
    }

    if (extras.length === 0) {
      return selectedCandidates;
    }

    extras.sort((a, b) => {
      if (a.lexicalScore !== b.lexicalScore) return b.lexicalScore - a.lexicalScore;
      return b.score - a.score;
    });

    const targetCount = Math.min(12, selectedCandidates.length + extras.length);
    return [...selectedCandidates, ...extras.slice(0, Math.max(0, targetCount - selectedCandidates.length))];
  }

  function batchFetchOutgoingEdges(symbolIds: number[]): Map<number, EdgeSummary[]> {
    const result = new Map<number, EdgeSummary[]>();
    if (symbolIds.length === 0) return result;

    for (let i = 0; i < symbolIds.length; i += EDGE_BATCH_CHUNK_SIZE) {
      const chunk = symbolIds.slice(i, i + EDGE_BATCH_CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT e.source_symbol_id, s.name AS target_name, e.kind
           FROM edges e
           JOIN symbols s ON s.id = e.target_symbol_id
           WHERE e.source_symbol_id IN (${placeholders})
             AND e.kind IN ('call', 'import')`
        )
        .all(...chunk) as { source_symbol_id: number; target_name: string; kind: string }[];

      for (const row of rows) {
        const list = result.get(row.source_symbol_id) ?? [];
        list.push({ targetName: row.target_name, kind: row.kind });
        result.set(row.source_symbol_id, list);
      }
    }

    return result;
  }

  function buildScoredNodes(sel: RankedCandidate[]): ScoredNode[] {
    const maxSc = sel.reduce((max, item) => Math.max(max, item.score), 0);
    const root = getCommonDisplayRoot(sel.map((item) => item.file.path));
    const cache = new Map<number, FileRecord>();

    const outgoingEdgesMap = batchFetchOutgoingEdges(sel.map((c) => c.symbol.id));

    return sel.map(({ symbol, file, score, distance }) => {
      const fullSymbol = symbols.getById(symbol.id) ?? {
        ...symbol,
        fullSource: "",
      };
      const displayFile =
        cache.get(file.id) ??
        ({ ...file, path: toDisplayPath(file.path, root) } satisfies FileRecord);
      if (!cache.has(file.id)) cache.set(file.id, displayFile);

      const outgoingEdges = outgoingEdgesMap.get(symbol.id);
      let compressionLevel = assignCompressionLevel(score, distance, maxSc);
      if (intent !== "narrow" && compressionLevel === 0) {
        const pathLower = displayFile.path.toLowerCase();
        const actionSignal = hasActionSignal(symbol.name, symbol.signature);
        if (!actionSignal && PAGE_ENTRY_PATH_RE.test(pathLower)) {
          compressionLevel = 1;
        } else if (!actionSignal && UI_COMPONENT_PATH_RE.test(pathLower)) {
          compressionLevel = 2;
        }
      }
      // Render without edges for initial tokenCount estimate — packer re-renders with edges
      const rendered = renderSymbol(fullSymbol, displayFile, compressionLevel);
      const tokenCount = estimateTokens(rendered);

      return { symbol: fullSymbol, file: displayFile, score, distance, compressionLevel, rendered, tokenCount, outgoingEdges };
    });
  }

  const hasObservationPayload = observations.some(
    (o) => o.note.trim().length > 0 && o.confidence > 0
  );
  const codeRatio = hasObservationPayload && intent === "narrow" ? 0.8 : 1.0;

  const isSingleFocusNarrowQuery = intent === "narrow" && exactQueryTerms.length <= 3;
  const baseLexThreshold =
    exactQueryTerms.length === 0
      ? 0
      : isSingleFocusNarrowQuery
        ? 2
        : 1;
  const broadLargeBudget = intent === "broad" && tokenBudget >= 8000;
  const candidateLimitMultiplier =
    intent === "narrow" ? 0.85 : intent === "broad" ? (broadLargeBudget ? 0.6 : 0.45) : 0.55;
  const dynamicLimit = Math.max(
    40,
    Math.floor((retrievalBudget / 10) * candidateLimitMultiplier)
  );
  const narrowHardCap = isSingleFocusNarrowQuery ? 48 : 80;
  const hardCap =
    intent === "narrow"
      ? narrowHardCap
      : intent === "broad"
        ? Math.max(broadLargeBudget ? 180 : 120, Math.floor(tokenBudget / (broadLargeBudget ? 32 : 50)))
        : 84;
  const baseCandidateLimit = Math.min(dynamicLimit, hardCap);

  const recentSymbolIds: Set<number> = hasExplicitSession && sessionCtx
    ? new Set(sessionCtx.getRecentSymbolIds().filter((id): id is number => id !== null))
    : new Set();
  const shouldDedupRecentSymbols =
    recentSymbolIds.size > 0 &&
    ((intent !== "narrow" && intent !== "symbol-lookup") || previousSameQueryTokens !== null);

  const baseMaxDistance =
    intent === "task"
      ? 0
      : intent === "broad"
        ? (broadLargeBudget ? 2 : 1)
        : isSingleFocusNarrowQuery
          ? 0
          : 1;
  let selected = backfillWithinSelectedFiles(
    ensureBroadFileSpread(
      pruneUiNoise(
        pruneByFileDiversity(
          selectCandidates(baseLexThreshold, baseMaxDistance, baseCandidateLimit)
        )
      )
    )
  );
  let scoredNodes = buildScoredNodes(selected);

  let layerCoverages: LayerCoverage[] = [];
  if ((intent === "broad" || intent === "task") && params.projectRoot) {
    const lanes = getRetrievalLanes(db, params.projectRoot);
    const expectedLayers = getExpectedLayers(db, params.projectRoot);
    if (lanes.length > 0 && expectedLayers.length > 0) {
      const coverageResult = checkChainCoverage(db, params.projectRoot, scoredNodes, expectedLayers, lanes);
      layerCoverages = coverageResult.coverages;
      if (coverageResult.fillNodes.length > 0) {
        scoredNodes = [...scoredNodes, ...coverageResult.fillNodes];
      }
    }
  }

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
  const recomputeTokensUsed = (nodes: ScoredNode[], summaries: string[]): number =>
    nodes.reduce((sum, node) => sum + node.tokenCount, 0) +
    summaries.reduce((sum, summary) => sum + countTokens(summary), 0);

  const stripUiPackedNoise = (nodes: ScoredNode[]): { packed: ScoredNode[]; removedTokens: number } => {
    if (
      queryUiFocused ||
      !(intent === "broad" || intent === "task" || intent === "debug") ||
      nodes.length === 0
    ) {
      return { packed: nodes, removedTokens: 0 };
    }

    const nonUiCount = nodes.filter((node) => !isUiLikePath(node.file.path)).length;
    if (nonUiCount < 2) {
      return { packed: nodes, removedTokens: 0 };
    }

    const filtered = nodes.filter((node) =>
      !isUiLikePath(node.file.path) || hasActionSignal(node.symbol.name, node.symbol.signature)
    );
    if (filtered.length === nodes.length) {
      return { packed: nodes, removedTokens: 0 };
    }

    const keptIds = new Set(filtered.map((node) => node.symbol.id));
    const removedTokens = nodes
      .filter((node) => !keptIds.has(node.symbol.id))
      .reduce((sum, node) => sum + node.tokenCount, 0);
    return { packed: filtered, removedTokens };
  };

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

  if (
    useMultiPass &&
    (intent === "broad" || intent === "task") &&
    tokensUsed < tokenBudget * 0.45 &&
    scoredNodes.length > packed.length
  ) {
    const singlePassFallback = packNodesStoryMode(scoredNodes, tokenBudget, codeRatio, clusterBySymbolId);
    if (singlePassFallback.tokensUsed > tokensUsed) {
      packed = singlePassFallback.packed;
      tokensUsed = singlePassFallback.tokensUsed;
      fileSummaries = singlePassFallback.fileSummaries;
      logger.debug("single-pass fallback", { n: packed.length, tokensUsed });
    }
  }

  if (
    (intent === "broad" || intent === "task") &&
    tokensUsed < tokenBudget * 0.4 &&
    scoredNodes.length > packed.length
  ) {
    const denseFallback = packNodes(scoredNodes, tokenBudget, codeRatio, 0.5);
    if (denseFallback.tokensUsed > tokensUsed) {
      packed = denseFallback.packed;
      tokensUsed = denseFallback.tokensUsed;
      fileSummaries = denseFallback.fileSummaries;
      logger.debug("dense fallback", { n: packed.length, tokensUsed });
    }
  }

  const skipPromotion = isOverBudget(0.8);

  if (
    intent === "narrow" &&
    !isSingleFocusNarrowQuery &&
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

  const strippedUiNoise = stripUiPackedNoise(packed);
  packed = strippedUiNoise.packed;
  if (strippedUiNoise.removedTokens > 0) {
    tokensUsed = Math.max(0, tokensUsed - strippedUiNoise.removedTokens);
  }

  if (
    (intent === "broad" || intent === "task") &&
    !skipPromotion &&
    tokenBudget >= 500 &&
    tokensUsed < tokenBudget * BROAD_TASK_MIN_UTILIZATION &&
    candidates.length > selected.length
  ) {
    const refillPasses = intent === "task"
      ? [
          {
            lexThreshold: Math.max(1, baseLexThreshold),
            maxDist: 1,
            limit: Math.min(candidates.length, baseCandidateLimit + 16),
          },
        ]
      : [
          {
            lexThreshold: Math.max(1.1, baseLexThreshold),
            maxDist: 1,
            limit: Math.min(candidates.length, baseCandidateLimit + 12),
          },
          ...(tokenBudget >= 5000
            ? [
                {
                  lexThreshold: Math.max(0.8, baseLexThreshold * 0.7),
                  maxDist: 2,
                  limit: Math.min(candidates.length, baseCandidateLimit + 28),
                },
              ]
            : []),
        ];

    for (const pass of refillPasses) {
      const expanded = backfillWithinSelectedFiles(
        ensureBroadFileSpread(
          pruneUiNoise(
            pruneByFileDiversity(
              selectCandidates(pass.lexThreshold, pass.maxDist, pass.limit)
            )
          )
        )
      );
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

      if (tokensUsed >= tokenBudget * BROAD_TASK_TARGET_UTILIZATION) {
        break;
      }
    }

    if (
      tokensUsed < tokenBudget * 0.50 &&
      tokenBudget >= 4000 &&
      candidates.length > selected.length
    ) {
      const expandedLimit = Math.min(candidates.length, baseCandidateLimit * 2);
      const expandedLexThreshold = Math.max(0, baseLexThreshold * 0.7);
      const deepExpanded = backfillWithinSelectedFiles(
        ensureBroadFileSpread(
          pruneUiNoise(
            pruneByFileDiversity(
              selectCandidates(expandedLexThreshold, 2, expandedLimit)
            )
          )
        )
      );
      if (deepExpanded.length > selected.length) {
        const deepExpandedNodes = buildScoredNodes(deepExpanded);
        const deepExpandedClusterMap = buildClusterBySymbolId(deepExpandedNodes);
        const deepExpandedResult = packNodesStoryMode(
          deepExpandedNodes,
          tokenBudget,
          codeRatio,
          deepExpandedClusterMap
        );
        if (deepExpandedResult.tokensUsed > tokensUsed) {
          selected = deepExpanded;
          scoredNodes = deepExpandedNodes;
          clusterBySymbolId = deepExpandedClusterMap;
          packed = deepExpandedResult.packed;
          tokensUsed = deepExpandedResult.tokensUsed;
          fileSummaries = deepExpandedResult.fileSummaries;
          logger.debug("deep-expand pass", { n: selected.length, tokensUsed });
        }
      }
    }

    if (tokensUsed < tokenBudget * 0.50 && selected.length > 0) {
      const fileScores = new Map<number, number>();
      for (const candidate of selected) {
        const current = fileScores.get(candidate.file.id) ?? 0;
        fileScores.set(candidate.file.id, current + candidate.score);
      }
      const topFileIds = [...fileScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);
      const topFileIdSet = new Set(topFileIds);
      const storySelected = selected.filter((c) => topFileIdSet.has(c.file.id));
      if (storySelected.length > 0 && storySelected.length < selected.length) {
        const storyNodes = buildScoredNodes(storySelected);
        const storyClusterMap = buildClusterBySymbolId(storyNodes);
        const storyResult = packNodesStoryMode(storyNodes, tokenBudget, codeRatio, storyClusterMap);
        if (storyResult.tokensUsed > tokensUsed) {
          selected = storySelected;
          scoredNodes = storyNodes;
          clusterBySymbolId = storyClusterMap;
          packed = storyResult.packed;
          tokensUsed = storyResult.tokensUsed;
          fileSummaries = storyResult.fileSummaries;
          logger.debug("story-complete fallback", { files: topFileIds.length, tokensUsed });
        }
      }
    }

    if (tokensUsed < tokenBudget * 0.75 && candidates.length > selected.length) {
      const topCandidateScore = ranked[0]?.score ?? 0;
      const scoreFloor = topCandidateScore * 0.3;
      const selectedIds = new Set(selected.map((c) => c.symbol.id));
      const remaining = ranked
        .filter((c) => !selectedIds.has(c.symbol.id) && c.score >= scoreFloor && c.lexicalScore > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      if (remaining.length > 0) {
        const fillSelected = [...selected, ...remaining];
        const fillNodes = buildScoredNodes(fillSelected);
        const fillClusterMap = buildClusterBySymbolId(fillNodes);
        const fillResult = packNodesStoryMode(fillNodes, tokenBudget, codeRatio, fillClusterMap);
        const packedIdsBefore = new Set(packed.map((n) => n.symbol.id));
        const fillPackedIds = new Set(fillResult.packed.map((n) => n.symbol.id));
        const droppedFromPacked = [...packedIdsBefore].filter((id) => !fillPackedIds.has(id));
        if (fillResult.tokensUsed > tokensUsed && droppedFromPacked.length === 0) {
          selected = fillSelected;
          scoredNodes = fillNodes;
          clusterBySymbolId = fillClusterMap;
          packed = fillResult.packed;
          tokensUsed = fillResult.tokensUsed;
          fileSummaries = fillResult.fileSummaries;
          logger.debug("fill-to-85 pass", { added: remaining.length, tokensUsed });
        }
      }
    }
  }

  const relevanceLexicalThreshold = baseLexThreshold;
  const canonicalFilePath = (node: ScoredNode): string =>
    getFile(node.symbol.fileId)?.path ?? node.file.path;

  const shouldStripTypeDeclarationsFromPacked = (): boolean =>
    intent !== "narrow" &&
    !explicitTypeQuery &&
    packed.some((node) => isRuntimeCodePath(canonicalFilePath(node))) &&
    packed.some((node) => isTypeDeclarationPath(canonicalFilePath(node)));

  const dedupDroppedNames: string[] = [];
  if (shouldDedupRecentSymbols) {
    const kept: ScoredNode[] = [];
    const dropped: ScoredNode[] = [];
    for (const node of packed) {
      if ((node.compressionLevel === 0 || node.compressionLevel === 1) && recentSymbolIds.has(node.symbol.id)) {
        dropped.push(node);
      } else {
        kept.push(node);
      }
    }
    if (kept.length > 0) {
      for (const node of dropped) {
        tokensUsed -= node.tokenCount;
        dedupDroppedNames.push(node.symbol.name);
      }
      packed = kept;
    }
    logger.debug("dedup pass complete", { recentCount: recentSymbolIds.size, droppedCount: dedupDroppedNames.length });
  }

  // Enrich L2 nodes with dependency info where remaining budget allows
  const codeBudgetForEnrich = Math.floor(tokenBudget * codeRatio);
  const enrichResult = enrichL2WithDeps(packed, tokensUsed, codeBudgetForEnrich);
  packed = enrichResult.packed;
  tokensUsed = enrichResult.tokensUsed;

  if (shouldStripTypeDeclarationsFromPacked()) {
    packed = packed.filter((node) => !isTypeDeclarationPath(canonicalFilePath(node)));
    fileSummaries = fileSummaries.filter(
      (summary) => !summary.includes("types/") && !summary.includes(".d.ts")
    );
    tokensUsed = recomputeTokensUsed(packed, fileSummaries);
  }

  if (previousSameQueryTokens !== null && previousSameQueryTokens > 0 && tokensUsed > previousSameQueryTokens) {
    const byAscendingScore = packed
      .map((node, index) => ({ node, index }))
      .sort((a, b) => a.node.score - b.node.score);

    for (const { node, index } of byAscendingScore) {
      if (tokensUsed <= previousSameQueryTokens) break;
      if (node.compressionLevel === 3) continue;

      const rendered = renderSymbol(node.symbol, node.file, 3, node.outgoingEdges);
      const tokenCount = countTokens(rendered);
      if (tokenCount >= node.tokenCount) continue;

      tokensUsed += tokenCount - node.tokenCount;
      packed[index] = {
        ...node,
        compressionLevel: 3,
        rendered,
        tokenCount,
      };
    }

    if (tokensUsed > previousSameQueryTokens && packed.length > 1) {
      const ordered = [...packed].sort((a, b) => a.score - b.score);
      while (tokensUsed > previousSameQueryTokens && ordered.length > 1) {
        const removed = ordered.shift();
        if (!removed) break;
        tokensUsed -= removed.tokenCount;
      }
      packed = ordered;
    }
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
  if (pivotQueryTerms.length > 0) {
    const queryTermSet = new Set(pivotQueryTerms.map((t) => t.toLowerCase()));
    const topScore = packed.reduce((max, n) => Math.max(max, n.score), 0);
    const before = packed.length;
    packed = packed.filter((node) => {
      if (pivotSymbolIds.has(node.symbol.id)) return true;
      if (node.score >= topScore * 0.5) return true;
      const nameTokens = tokenizeSymbolName(node.symbol.name);
      const sigTokens = tokenizeSymbolName(node.symbol.signature ?? "");
      return [...nameTokens, ...sigTokens].some((token) => queryTermSet.has(token));
    });
    const dropped = before - packed.length;
    if (dropped > 0) {
      tokensUsed = recomputeTokensUsed(packed, fileSummaries);
      logger.debug("post-pack semantic validation", { dropped, remaining: packed.length });
    }
  }

  const packedClusters = new Set<number>();
  const finalUiStrip = stripUiPackedNoise(packed);
  packed = finalUiStrip.packed;
  if (finalUiStrip.removedTokens > 0) {
    tokensUsed = Math.max(0, tokensUsed - finalUiStrip.removedTokens);
  }
  const fileSymbolCounts = new Map<string, number>();
  for (const node of packed) {
    const clusterId = clusterBySymbolId.get(node.symbol.id);
    if (clusterId !== undefined) {
      packedClusters.add(clusterId);
    }
    const filePath = canonicalFilePath(node);
    fileSymbolCounts.set(filePath, (fileSymbolCounts.get(filePath) ?? 0) + 1);
  }
  const fileCounts = [...fileSymbolCounts.values()];
  const avgSymbolsPerFile =
    fileCounts.length === 0 ? 0 : fileCounts.reduce((sum, value) => sum + value, 0) / fileCounts.length;
  const maxSymbolsPerFile = fileCounts.length === 0 ? 0 : Math.max(...fileCounts);
  const uniqueFiles = new Set(packed.map((node) => canonicalFilePath(node)));
  const queryCoverageGroups = buildQueryCoverageGroups(baseQueryTerms)
    .map((group) => group.filter((term) => term.length > 2))
    .filter((group) => group.length > 0);
  const packedCoverageTerms = new Set<string>();
  for (const node of packed) {
    for (const term of extractPathTerms(canonicalFilePath(node))) {
      packedCoverageTerms.add(term);
    }
    for (const term of tokenizeCoverageTerms(`${node.symbol.name} ${node.symbol.signature}`)) {
      packedCoverageTerms.add(term);
    }
  }
  const matchedQueryTerms = queryCoverageGroups.filter((group) =>
    group.some((term) =>
      [...packedCoverageTerms].some((candidate) => coverageTermsMatch(term, candidate))
    )
  );
  const queryTermCoverage =
    queryCoverageGroups.length === 0 ? 1 : matchedQueryTerms.length / queryCoverageGroups.length;
  const moduleCoverage =
    relevantClusters.size > 0
      ? packedClusters.size / relevantClusters.size
      : packedClusters.size > 0
        ? 0.5
        : 0;
  const retrievalSurfaceScore =
    intent === "narrow"
      ? 1
      : Math.min(
          1,
          (rawPivotIds.size + packed.length + uniqueFiles.size + fileSummaries.length) /
            (intent === "broad" ? 18 : 14)
        );

  const reasons: string[] = [];
  if (symbolNotFound) reasons.push("symbol not found in index");
  if (pivotCount === 0) reasons.push("no pivot symbol match");
  if (pivotCount > 0 && pivotCoverage < 0.5) reasons.push("pivot coverage below 50%");
  if (selectedNonPivots > 0 && dependencyCoverage < 0.25) {
    reasons.push("dependency coverage below 25%");
  }
  if (noiseRatio > 0.6) reasons.push("low-relevance content exceeds 60%");
  const structurallyHealthySemanticMatch =
    intent !== "narrow" &&
    queryTermCoverage < 0.6 &&
    pivotCoverage >= 0.75 &&
    dependencyCoverage >= 0.75 &&
    moduleCoverage >= 0.75 &&
    retrievalSurfaceScore >= 0.75 &&
    noiseRatio <= 0.2;
  if (intent !== "narrow" && queryTermCoverage < 0.6 && !structurallyHealthySemanticMatch) {
    reasons.push("query term coverage below 60%");
  }
  if (intent !== "narrow" && retrievalSurfaceScore < 0.5) {
    reasons.push(`${intent} retrieval surface too thin`);
  }

  const tokenUtilization = tokenBudget > 0 ? tokensUsed / tokenBudget : 0;
  const coverageConfidence = computeCoverageConfidence({
    intent,
    pivotCount,
    pivotsIncluded,
    relevantPivotsIncluded,
    totalRelevantPivots: relevantPivotIds.size,
    dependencyCoverage,
    noiseRatio,
    fileSummaryCount: fileSummaries.length,
    tokenUtilization,
    queryTermCoverage,
    retrievalSurfaceScore,
    moduleCoverageStats: {
      packedClusters: packedClusters.size,
      relevantClusters: relevantClusters.size,
      avgSymbolsPerFile,
      maxSymbolsPerFile,
    },
    packedSymbolNames: packed.map((n) => n.symbol.name),
    queryTerms: baseQueryTerms,
  });
  const effectiveCoverageConfidence = symbolNotFound
    ? Math.min(coverageConfidence, 0.44)
    : coverageConfidence;
  const confidenceFloor = intent === "narrow" ? 0.55 : 0.6;
  const uncertaintyFlag = reasons.length > 0 || effectiveCoverageConfidence < confidenceFloor;
  if (effectiveCoverageConfidence < confidenceFloor) {
    reasons.push(`overall coverage confidence below ${Math.round(confidenceFloor * 100)}%`);
  }
  const uncertainty = buildUncertainty(uncertaintyFlag, reasons.length, effectiveCoverageConfidence, tokenUtilization);

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

  const timeLimited = skipBfs || skipPromotion || elapsed() > maxQueryTimeMs;

  const baseMetadata: Omit<CapsuleMetadata, "filesIncluded" | "diagnostics"> = {
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
      coverageConfidence: effectiveCoverageConfidence,
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
      hybridSearch: hybridStrategy,
    },
    ...(clusterGroups.length > 0 ? { clusterGroups } : {}),
    generatedAt: Date.now(),
    ...(timeLimited && { timeLimited: true }),
    ...(symbolNotFound && { symbolNotFound: true }),
    ...(dedupDroppedNames.length > 0 ? { previouslyCovered: dedupDroppedNames } : {}),
  };

  const metadata: CapsuleMetadata = {
    ...baseMetadata,
    filesIncluded: [...uniqueFiles],
    patterns: getPatternsForFiles(db, [...uniqueFiles]),
    layerCoverages: layerCoverages.length > 0 ? layerCoverages : undefined,
    diagnostics: diagnose(baseMetadata, pivotScores, intent === "symbol-lookup" || intent === "debug" ? "narrow" : intent),
  };

  const visibleObs = selectObservations(observations, metadata);
  recordObservationHits(db, visibleObs.map((o) => o.id));
  let content = formatCapsule(packed, observations, metadata, fileSummaries);
  if (symbolNotFound) {
    const note = `Note: No symbol named '${query}' found in the index. Showing related symbols.\n`;
    content = note + content;
  }
  const structured = buildStructuredOutput(packed, observations, metadata, content);

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

  if (hasExplicitSession) {
    safeWrite("observation", () => {
      captureQueryObservation(db, query, pivotSymbolIds, sessionId, params.projectRoot ?? "");
    });
  }

  if (hasExplicitSession && packed.length > 0 && sessionCtx) {
    safeWrite("session_context", () => {
      const symbolsToRecord = packed.map((node) => ({
        symbolId: node.symbol.id,
        fileId: node.symbol.fileId,
      }));
      sessionCtx.record(symbolsToRecord, query);
    });
  }

  if (hasExplicitSession && !uncertaintyFlag && packed.length > 0) {
    safeWrite("capsule-insight", () => {
      const alreadyStored = db.prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM observations WHERE session_id = ? AND scope = 'capsule-insight' LIMIT 1"
      ).get(sessionId!) ?? { count: 0 };
      if (alreadyStored.count === 0) {
        const topNames = packed
          .slice(0, 3)
          .map((n) => n.symbol.name);
        const fileCount = uniqueFiles.size;
        const symbolCount = packed.length;
        const store = new ObservationStore(db);
        store.create({
          sessionId: sessionId!,
          scope: "capsule-insight",
          note: `Query "${query}" resolved to ${fileCount} file${fileCount !== 1 ? "s" : ""} across ${symbolCount} symbols (top: ${topNames.join(", ")})`,
          symbolId: packed[0]?.symbol.id,
          confidence: effectiveCoverageConfidence,
        });
      }
    });
  }

  if (hasExplicitSession) {
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
  }

  return { content, metadata, structured };
}

export async function generateCapsuleWithRuntime(
  db: Database.Database,
  params: CapsuleParams,
  embeddingRuntime: EmbeddingRuntime | null | undefined
): Promise<CapsuleOutput> {
  if (!embeddingRuntime) {
    return generateCapsule(db, params);
  }

  try {
    const classified = classifyQueryIntent(params.query);
    const queryTerms =
      classified.focusTerms.length > 0
        ? classified.focusTerms
        : classified.normalizedTerms.length > 0
          ? classified.normalizedTerms
          : params.query.split(/\s+/).filter((term) => term.length > 1);
    const queryEmbedding = await embeddingRuntime.embedder.embed(params.query);
    const hybridSearchResults = await hybridSearch(db, embeddingRuntime, {
      query: params.query,
      queryTerms,
      idfWeights: computeTermIDF(db, queryTerms),
      queryEmbedding,
      projectRoot: params.projectRoot,
      pathRestriction: params.path,
      glob: params.glob,
      limit: 36,
    });

    return generateCapsule(db, {
      ...params,
      hybridSearchResults,
    });
  } catch (error) {
    logger.warn("hybrid runtime unavailable during capsule generation; falling back to lexical retrieval", {
      error: error instanceof Error ? error.message : String(error),
    });
    return generateCapsule(db, params);
  }
}
