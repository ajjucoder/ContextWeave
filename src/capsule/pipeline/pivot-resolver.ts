/**
 * Pivot resolution stage for capsule generation.
 */
import { dirname } from "node:path";
import type Database from "better-sqlite3";
import { fuzzyMatch } from "../../utils/fuzzy.js";
import { expandQueryWithSynonyms } from "../../utils/synonyms.js";
import { getDirectoryWeight } from "../../utils/directory-weights.js";
import { isFrameworkEntryPath, normalizeRetrievalPath } from "../../utils/path-retrieval.js";
import { rankPivotsWithScores, scorePivotRelevance } from "../pivot-scorer.js";
import { ACTION_SIGNAL_TERMS } from "../signals.js";
import { classifyQueryIntent } from "../intent-classifier.js";
import {
  decomposeForBroad,
  decomposeForTask,
  decomposeQuery,
  decomposeTerms,
  mergeSubQueryTerms,
  type ClusterHint,
} from "../query-decomposer.js";
import { searchFilesByQuery } from "../../core/file-summaries.js";
import { getFileClusterId, getClusterFileIds } from "../../core/clusters.js";
import { MemorySearch } from "../../memory/search.js";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { sessionQueries } from "../../db/queries/sessions.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { getRetrievalLanes } from "../../core/repo-profiler.js";
import { contentFallbackSearch } from "../content-fallback.js";
import { SessionContext } from "../session-context.js";
import type { FileRecord } from "../../core/types.js";
import type { CapsuleContext, PivotCandidate, PivotResolution } from "./types.js";

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
const idfStmtCache = new WeakMap<Database.Database, ReturnType<Database.Database["prepare"]>>();
const connectedSymbolsStmtCache = new WeakMap<Database.Database, Database.Statement<[number, number, number], { symbolId: number; fileId: number }>>();

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

export function getRuntimeKindWeight(kind: string, preferRuntimeKinds: boolean): number {
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

export function getPivotKindWeight(kind: string, preferRuntimeKinds: boolean): number {
  if (!preferRuntimeKinds) return 1;
  const normalizedKind = kind.toLowerCase();
  if (normalizedKind === "function" || normalizedKind === "method") return 1.2;
  if (normalizedKind === "class") return 1.1;
  if (normalizedKind === "interface" || normalizedKind === "type") return 0.75;
  if (normalizedKind === "variable") return 0.9;
  return 1;
}

export function hasActionSignal(name: string, signature: string): boolean {
  const haystack = `${name} ${signature}`.toLowerCase();
  return [...ACTION_SIGNAL_TERMS].some((term) => haystack.includes(term));
}

export function isTypeDeclarationPath(path: string): boolean {
  return TYPE_DECLARATION_PATH_RE.test(path);
}

export function isRuntimeCodePath(path: string): boolean {
  return RUNTIME_CODE_PATH_RE.test(path);
}

export function tokenizeCoverageTerms(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

export function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let i = 0;
  while (i < max && left[i] === right[i]) i += 1;
  return i;
}

export function coverageTermsMatch(queryTerm: string, candidate: string): boolean {
  return candidate === queryTerm || candidate.includes(queryTerm) || commonPrefixLength(queryTerm, candidate) >= 4;
}

export function getConnectedSymbols(db: Database.Database, symbolId: number): Array<{ symbolId: number; fileId: number }> {
  let stmt = connectedSymbolsStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare<[number, number, number], { symbolId: number; fileId: number }>(`
      SELECT s.id as symbolId, s.file_id as fileId FROM edges e
      JOIN symbols s ON (
        CASE WHEN e.source_symbol_id = ? THEN e.target_symbol_id ELSE e.source_symbol_id END = s.id
      )
      WHERE (e.source_symbol_id = ? OR e.target_symbol_id = ?)
        AND e.kind IN ('call', 'implements', 'type_usage', 'inheritance')
      LIMIT 6
    `);
    connectedSymbolsStmtCache.set(db, stmt);
  }
  return stmt.all(symbolId, symbolId, symbolId);
}

export function buildPivotCandidates(
  context: CapsuleContext,
  candidateIds: Iterable<number>,
  suppressTypeDeclarations: boolean,
  pivotFileCache: Map<number, string>
): PivotCandidate[] {
  const candidates: PivotCandidate[] = [];
  for (const id of candidateIds) {
    const sym = context.symbols.getByIdLight(id);
    if (!sym) continue;
    let filePath = pivotFileCache.get(sym.fileId);
    if (filePath === undefined) {
      const file = context.files.getById(sym.fileId);
      filePath = file?.path ?? "";
      pivotFileCache.set(sym.fileId, filePath);
    }
    if (suppressTypeDeclarations && isTypeDeclarationPath(filePath)) continue;
    if (getDirectoryWeight(normalizeRetrievalPath(filePath, 6), context.params.projectRoot) <= 0.2) continue;
    candidates.push({ id, name: sym.name, signature: sym.signature ?? "", kind: sym.kind, filePath });
  }
  return candidates;
}

export function isExactSymbolNameMatch(name: string, exactQueryTermSet: Set<string>): boolean {
  const nameLower = name.toLowerCase();
  if (exactQueryTermSet.has(nameLower)) return true;
  const nameTokens = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return nameTokens.length > 1 && nameTokens.every((token) => exactQueryTermSet.has(token));
}

export function resolvePivots(context: CapsuleContext): PivotResolution {
  const { db, files, symbols, query, tokenBudget } = context;
  const classified = classifyQueryIntent(query);
  const intent = classified.intent;
  const retrievalBudget = Math.max(tokenBudget, Math.round(tokenBudget * classified.suggestedBudgetMultiplier));
  const activeLanes = (intent === "broad" || intent === "task") && context.params.projectRoot
    ? getRetrievalLanes(db, context.params.projectRoot)
    : [];

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
    : query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
  const intentTerms =
    intent === "task"
      ? (classified.focusTerms.length > 0 ? classified.focusTerms : classified.normalizedTerms)
      : classified.normalizedTerms;
  const baseQueryTerms = intentTerms.length > 0 ? intentTerms : fallbackTerms;
  const rawPivotIds = new Set<number>();
  const seededPivotIdsByFile = new Map<number, number[]>();

  const FILE_SEARCH_LIMIT = intent === "narrow" ? 50 : 80;
  let candidateFiles = searchFilesByQuery(db, query, FILE_SEARCH_LIMIT, context.params.projectRoot);
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
  const pivotQueryTerms = intent === "narrow" ? exactQueryTerms : expandedQueryTerms;
  const memorySearch = new MemorySearch(db);
  const observationBudget = Math.floor(tokenBudget * 0.2);
  const { observations } = memorySearch.getRelevantForCapsule(query, observationBudget);
  const typeFocusedQuery = allQueryTerms.some((term) => TYPE_FOCUSED_TERMS.has(term));
  const runtimeFocusedQuery = pivotQueryTerms.some((term) => RUNTIME_QUERY_TERMS.has(term));
  const hasRuntimeCandidateFile = candidateFiles.some((candidate) => isRuntimeCodePath(candidate.path));
  let suppressTypeDeclarations =
    intent !== "narrow" && runtimeFocusedQuery && !typeFocusedQuery && hasRuntimeCandidateFile;
  if (suppressTypeDeclarations) {
    candidateFiles = candidateFiles.filter((candidate) => !isTypeDeclarationPath(candidate.path));
  }
  for (const [index, candidate] of candidateFiles.slice(0, intent === "broad" ? 20 : 16).entries()) {
    const boost = Math.max(1, 1.38 - index * 0.05);
    candidateFileBoostById.set(candidate.fileId, boost);
  }
  let candidateFileIds = candidateFiles.length > 0 ? new Set(candidateFiles.map((f) => f.fileId)) : null;
  if (intent === "broad" || intent === "task" || intent === "debug") {
    candidateFileIds = null;
  }
  const preferRuntimeKinds = intent === "task" && candidateFiles.length > 0 && candidateFiles.length <= 6 && !typeFocusedQuery;
  const hybridSearchResults = context.params.hybridSearchResults ?? [];
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

    if (intent !== "symbol-lookup") {
      const top10SymbolIds = [...rawPivotIds].slice(0, 10);
      const expansion: { symbolId: number; fileId: number }[] = [];
      for (const symbolId of top10SymbolIds) {
        if (expansion.length >= 20) break;
        const rows = getConnectedSymbols(db, symbolId);
        for (const row of rows) {
          if (!rawPivotIds.has(row.symbolId)) {
            expansion.push(row);
            if (expansion.length >= 20) break;
          }
        }
      }
      for (const { symbolId, fileId } of expansion) {
        rawPivotIds.add(symbolId);
        if (!candidateFileBoostById.has(fileId)) {
          candidateFileBoostById.set(fileId, 1.1);
        }
      }
    }
  }

  const exactQueryTermSet = new Set(exactQueryTerms);
  const queryLooksTestFocused = ["test", "tests", "spec", "fixture", "fixtures", "mock", "mocks"].some((term) => allQueryTerms.includes(term));
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

  const perTermSymbolCap = intent === "narrow" ? 15 : intent === "broad" ? 10 : 12;
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
        if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
        if (b.centrality !== a.centrality) return b.centrality - a.centrality;
        return a.startLine - b.startLine;
      })
      .slice(0, memoryBridgeSymbolCap)
      .map((symbol) => symbol.id);

  for (const observation of observations) {
    if (observation.symbolId != null) memoryCandidateSymbolIds.add(observation.symbolId);
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
      const fileRecord = files.getById(candidate.fileId);
      const fileSymbols = symbols
        .getByFileIdLight(candidate.fileId)
        .map((symbol) => ({
          symbol,
          score: scorePivotRelevance(
            {
              name: symbol.name,
              signature: symbol.signature,
              kind: symbol.kind,
              filePath: fileRecord?.path ?? "",
            },
            pivotQueryTerms
          ),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.symbol.isExported !== b.symbol.isExported) return a.symbol.isExported ? -1 : 1;
          if (b.symbol.centrality !== a.symbol.centrality) return b.symbol.centrality - a.symbol.centrality;
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
    const EXACT_MATCH_THRESHOLD = 3;
    const exactMatches = symbols.getByNameCI(term);
    const exactFiltered = candidateFileIds ? exactMatches.filter((symbol) => candidateFileIds.has(symbol.fileId)) : exactMatches;
    for (const symbol of exactFiltered.slice(0, perTermSymbolCap)) {
      rawPivotIds.add(symbol.id);
      if (rawPivotIds.size >= maxStageARaw) break;
    }

    if (exactFiltered.length < EXACT_MATCH_THRESHOLD && term.length >= 3) {
      const ftsMatches = symbols.searchFTS(term, perTermSymbolCap);
      const filtered = candidateFileIds ? ftsMatches.filter((symbol) => candidateFileIds.has(symbol.fileId)) : ftsMatches;
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

  if (intent !== "narrow" && rawPivotIds.size < maxStageARaw && pathCandidateCache.size > 0) {
    const coveredFileIds = new Set<number>();
    for (const id of rawPivotIds) {
      const symbol = symbols.getByIdLight(id);
      if (symbol) coveredFileIds.add(symbol.fileId);
    }
    for (const [filePath, file] of pathCandidateCache) {
      if (rawPivotIds.size >= maxStageARaw) break;
      if (coveredFileIds.has(file.id)) continue;
      const queryTerms = exactQueryTerms.map((term) => term.toLowerCase());
      const fileTerms = tokenizeCoverageTerms(filePath);
      if (!queryTerms.some((term) => fileTerms.some((candidate) => coverageTermsMatch(term, candidate)))) continue;
      const fileSymbols = symbols.getByFileIdLight(file.id);
      for (const symbol of fileSymbols.slice(0, pathFileSymbolCap)) {
        rawPivotIds.add(symbol.id);
        if (rawPivotIds.size >= maxStageARaw) break;
      }
    }
  }

  if ((intent === "broad" || intent === "task") && rawPivotIds.size > 0 && rawPivotIds.size < maxStageARaw) {
    const GRAPH_EXPAND_LIMIT = Math.min(30, maxStageARaw - rawPivotIds.size);
    const CALL_EDGE_KINDS = new Set(["call", "callback", "server-action", "route-handler", "framework_entry", "event"]);
    const graphSeeds = [...rawPivotIds].slice(0, 10);
    const graphCandidates: Array<{ id: number; edgeKind: string }> = [];
    const edges = edgeQueries(db);
    for (const seedId of graphSeeds) {
      for (const edge of edges.getBySource(seedId)) {
        if (CALL_EDGE_KINDS.has(edge.kind) && !rawPivotIds.has(edge.targetSymbolId)) {
          graphCandidates.push({ id: edge.targetSymbolId, edgeKind: edge.kind });
        }
      }
      for (const edge of edges.getByTarget(seedId)) {
        if (CALL_EDGE_KINDS.has(edge.kind) && !rawPivotIds.has(edge.sourceSymbolId)) {
          graphCandidates.push({ id: edge.sourceSymbolId, edgeKind: edge.kind });
        }
      }
    }
    for (const candidate of graphCandidates.slice(0, GRAPH_EXPAND_LIMIT)) {
      rawPivotIds.add(candidate.id);
    }
  }

  const maxPivots =
    intent === "narrow"
      ? Math.max(30, Math.min(120, Math.floor(retrievalBudget / 50)))
      : intent === "broad"
        ? Math.max(40, Math.min(100, Math.floor(retrievalBudget / 160)))
        : Math.max(50, Math.min(120, Math.floor(retrievalBudget / 150)));
  const pivotFileCache = new Map<number, string>();
  if (rawPivotIds.size < 3 && !hybridSearchEnabled) {
    const preFallbackCandidates = buildPivotCandidates(context, rawPivotIds, suppressTypeDeclarations, pivotFileCache);
    const preFallbackRanking = rankPivotsWithScores(
      preFallbackCandidates,
      exactQueryTerms.length > 0 ? exactQueryTerms : pivotQueryTerms,
      maxPivots,
      idfWeights
    );
    const exactPivotIds = new Set(
      preFallbackCandidates.filter((candidate) => isExactSymbolNameMatch(candidate.name, exactQueryTermSet)).map((candidate) => candidate.id)
    );
    const exactPivot = preFallbackRanking.scored.find((entry) => exactPivotIds.has(entry.id));

    if (exactPivot) {
      let added = 0;
      const relatedRows = [
        ...(context.getDirectCallerIds.all(exactPivot.id) as Array<{ symbolId: number }>),
        ...(context.getDirectCalleeIds.all(exactPivot.id) as Array<{ symbolId: number }>),
      ];
      for (const row of relatedRows) {
        if (!rawPivotIds.has(row.symbolId)) {
          rawPivotIds.add(row.symbolId);
          added += 1;
        }
      }
      context.logger.info("exact match fast path activated", {
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
          if (file && isTypeDeclarationPath(file.path)) continue;
        }
        if (!rawPivotIds.has(match.symbolId)) {
          rawPivotIds.add(match.symbolId);
          added += 1;
        }
      }
      if (added > 0) {
        context.logger.info("content fallback activated", { additionalPivots: added, totalPivots: rawPivotIds.size });
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
      context.logger.info("memory bridge activated", { addedPivots: added, totalPivots: rawPivotIds.size });
    }
  }

  context.logger.debug("raw pivot candidates", { count: rawPivotIds.size });
  let pivotCandidates = buildPivotCandidates(context, rawPivotIds, suppressTypeDeclarations, pivotFileCache);
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

  const pivotRanking = rankPivotsWithScores(pivotCandidates, pivotQueryTerms, maxPivots, idfWeights);
  let rankedPivots = pivotRanking.ranked;
  let pivotScores = pivotRanking.scores;
  const exactPivotIds = new Set(
    pivotCandidates.filter((candidate) => isExactSymbolNameMatch(candidate.name, exactQueryTermSet)).map((candidate) => candidate.id)
  );

  if (intent !== "narrow" && rankedPivots.size > 0) {
    const pivotKinds = new Map(pivotCandidates.map((candidate) => [candidate.id, candidate.kind]));
    const adjustedEntries = [...rankedPivots.entries()]
      .map(([id, score]) => [id, score * getPivotKindWeight(pivotKinds.get(id) ?? "", preferRuntimeKinds)] as const)
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
      const lower = candidate.path.toLowerCase();
      if (lower.includes("/test") || lower.includes(".test.")) continue;
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

  const singleIdentifierRe = /^[a-zA-Z_]\w*$/;
  const queryLower = query.toLowerCase();
  const symbolNotFound =
    singleIdentifierRe.test(query) &&
    pivotCandidates.every((candidate) => candidate.name.toLowerCase() !== queryLower);

  const sameNameDefinitions =
    (intent === "symbol-lookup" || intent === "narrow") && singleIdentifierRe.test(query)
      ? pivotCandidates.filter((candidate) => candidate.name.toLowerCase() === queryLower)
      : [];
  const hasSameNameCollision = sameNameDefinitions.length >= 2;

  const sessionId = context.params.sessionId?.trim() || null;
  const hasExplicitSession = typeof sessionId === "string" && sessionId.length > 0;
  const sessionCtx = hasExplicitSession ? new SessionContext(db, sessionId) : null;
  if (hasExplicitSession) {
    sessionQueries(db).ensureSession(sessionId, context.params.projectRoot ?? "");
  }
  const previousSameQueryTokens = hasExplicitSession
    ? capsuleLogQueries(db).getBySessionAndQuery(sessionId, query)?.tokensUsed ?? null
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
        rankedPivots.set(candidate.id, existing > 0 ? existing * 1.5 : 0.5);
      }
    }
  }

  const pivotSymbolIds = new Set(rankedPivots.keys());
  const topLocalityPivotIds = new Set(
    [...rankedPivots.entries()].sort((a, b) => b[1] - a[1]).slice(0, intent === "narrow" ? 20 : 12).map(([id]) => id)
  );
  const pivotScoreValues = [...rankedPivots.values()].sort((a, b) => a - b);
  const medianPivotScore = pivotScoreValues.length > 0
    ? pivotScoreValues[Math.floor(pivotScoreValues.length / 2)] ?? 0
    : 0;
  const relevantPivotIds = new Set(
    [...rankedPivots.entries()].filter(([, score]) => score >= medianPivotScore).map(([id]) => id)
  );
  context.logger.debug("pivot symbols after ranking", {
    raw: rawPivotIds.size,
    ranked: pivotSymbolIds.size,
    relevant: relevantPivotIds.size,
  });

  return {
    classified,
    intent,
    retrievalBudget,
    activeLanes,
    candidateFiles,
    candidateFileBoostById,
    allQueryTerms,
    exactQueryTerms,
    expandedQueryTerms,
    pivotQueryTerms,
    exactQueryTermSet,
    idfWeights,
    observations,
    rawPivotIds,
    pivotCandidates,
    rankedPivots,
    pivotScores,
    pivotSymbolIds,
    exactPivotIds,
    relevantPivotIds,
    topLocalityPivotIds,
    queryUiFocused,
    queryLooksTestFocused,
    explicitTypeQuery,
    suppressTypeDeclarations,
    symbolNotFound,
    sameNameDefinitions,
    hasSameNameCollision,
    useMultiPass,
    subQueries,
    impliedModuleDirs,
    preferRuntimeKinds,
    hybridStrategy: {
      enabled: hybridSearchEnabled,
      applied: hybridSearchEnabled,
      candidateCount: hybridSearchResults.length,
      exactMatches: hybridSearchResults.filter((result) => result.exactMatchRank !== null).length,
    },
    sessionId,
    hasExplicitSession,
    sessionCtx,
    previousSameQueryTokens,
    recentFileIds,
  };
}
