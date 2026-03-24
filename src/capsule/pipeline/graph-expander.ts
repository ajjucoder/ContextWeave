/**
 * Graph expansion stage for capsule generation.
 */
import { dirname, resolve } from "node:path";
import { globToRegExp, toProjectRelativePath, withinPath } from "../../mcp/tools/path-filters.js";
import { getBatchSymbolDegrees, getDepthForBudget } from "../../core/graph.js";
import { weightedBfsTraversal } from "../../core/weighted-bfs.js";
import { quantile, getLexicalScore } from "../generator-helpers.js";
import type { FileRecord } from "../../core/types.js";
import type { CapsuleContext, GraphExpansion, PivotResolution, RankedCandidate } from "./types.js";
import { isTypeDeclarationPath } from "./pivot-resolver.js";

const MAX_BFS_VISITED_DIVISOR = 12;
const MAX_BFS_VISITED_CAP = 500;
const MAX_BFS_HOPS = 8;

export function expandGraph(context: CapsuleContext, pivot: PivotResolution): GraphExpansion {
  const { symbols, files } = context;
  const observationCountBySymbol = new Map<number, number>();
  const observationCountByFile = new Map<number, number>();
  for (const observation of pivot.observations) {
    if (observation.symbolId != null) {
      observationCountBySymbol.set(observation.symbolId, (observationCountBySymbol.get(observation.symbolId) ?? 0) + 1);
    }
    if (observation.fileId != null) {
      observationCountByFile.set(observation.fileId, (observationCountByFile.get(observation.fileId) ?? 0) + 1);
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
  for (const id of pivot.pivotSymbolIds) {
    const symbol = symbols.getByIdLight(id);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;
    const normalizedPath = normalizeRetrievalPath(file.path, 6);
    pivotFileIds.add(file.id);
    pivotDirs.add(dirname(normalizedPath));
    if (pivot.topLocalityPivotIds.has(id)) {
      localityPivotDirs.add(dirname(normalizedPath));
    }
  }

  const skipBfs = context.isOverBudget(0.5);
  const baseDepth = getDepthForBudget(pivot.retrievalBudget);
  const hasExactPivot = pivot.exactPivotIds.size > 0;
  const maxDepth =
    pivot.intent === "broad"
      ? Math.max(2, baseDepth - 1)
      : pivot.intent === "task"
        ? Math.min(6, baseDepth)
        : pivot.intent === "symbol-lookup"
          ? (hasExactPivot ? 2 : Math.min(3, baseDepth))
          : (hasExactPivot && pivot.intent === "narrow" ? Math.min(baseDepth, 3) : baseDepth);
  const rankingPivotDirs =
    pivot.intent === "broad"
      ? pivotDirs
      : pivot.intent === "narrow" || localityPivotDirs.size === 0
        ? pivotDirs
        : localityPivotDirs;
  const scopeDirSet = new Set<string>(rankingPivotDirs);
  if (pivot.intent === "task") {
    for (const dir of pivot.impliedModuleDirs) {
      scopeDirSet.add(dir);
    }
  }
  const scopeDirs = scopeDirSet.size > 0 ? [...scopeDirSet] : null;
  const maxVisitedBase = Math.min(MAX_BFS_VISITED_CAP, Math.floor(pivot.retrievalBudget / MAX_BFS_VISITED_DIVISOR));
  const maxVisitedNodes = pivot.intent === "symbol-lookup" && hasExactPivot
    ? Math.min(maxVisitedBase, 30)
    : maxVisitedBase;
  const effectiveBfsDepth = skipBfs ? 1 : maxDepth;
  const bfsIncomingMult = pivot.intent === "broad" ? 4.0 : 1.5;
  const bfsSeeds = [...pivot.pivotSymbolIds].map((symbolId) => ({
    symbolId,
    weightBoost: pivot.anchorBoostBySymbolId.get(symbolId) ?? 1,
  }));
  const bfsNodes = weightedBfsTraversal(
    context.db,
    bfsSeeds,
    effectiveBfsDepth,
    scopeDirs,
    { maxVisitedNodes, maxHops: MAX_BFS_HOPS, incomingEdgeCostMultiplier: bfsIncomingMult }
  );
  const visited = new Map<number, number>(bfsNodes.map((node) => [node.symbolId, node.distance]));
  const traversalBoosts = new Map<number, number>(bfsNodes.map((node) => [node.symbolId, node.weightBoost]));

  context.logger.debug("bfs traversal complete", { nodesVisited: visited.size });

  const pathGlobRegex = context.params.glob ? globToRegExp(context.params.glob) : null;
  const scopePath = context.params.path?.trim() ?? null;
  const resolvedProjectRoot = context.params.projectRoot ? resolve(context.params.projectRoot) : null;
  const hasPathRestriction = pathGlobRegex !== null || scopePath !== null;

  const SMALL_CODEBASE_THRESHOLD = 100;
  const totalSymbolCount = symbols.count();
  if (
    totalSymbolCount > 0 &&
    totalSymbolCount <= SMALL_CODEBASE_THRESHOLD &&
    visited.size < totalSymbolCount * 0.5 &&
    (pivot.intent === "broad" || pivot.intent === "task")
  ) {
    for (const id of symbols.getAllIds()) {
      if (!visited.has(id)) visited.set(id, 3);
    }
    context.logger.debug("small-codebase expansion", { totalSymbols: totalSymbolCount, visitedAfter: visited.size });
  }

  const candidates: RankedCandidate[] = [];
  const centralityValues: number[] = [];
  const degreeValues: number[] = [];
  const allVisitedIds = [...visited.keys()];
  const batchDegrees = getBatchSymbolDegrees(context.db, allVisitedIds);

  for (const [symbolId, distance] of visited) {
    const symbol = symbols.getByIdLight(symbolId);
    if (!symbol) continue;
    const file = getFile(symbol.fileId);
    if (!file) continue;
    if (pivot.suppressTypeDeclarations && isTypeDeclarationPath(file.path)) continue;

    if (hasPathRestriction) {
      const relPath = resolvedProjectRoot ? toProjectRelativePath(resolvedProjectRoot, file.path) : file.path;
      if (scopePath && !withinPath(relPath, scopePath)) continue;
      if (pathGlobRegex && !pathGlobRegex.test(relPath)) continue;
    }

    const degree = batchDegrees.get(symbolId) ?? 0;
    const lexicalScore = getLexicalScore(symbol, file, pivot.expandedQueryTerms, pivot.exactQueryTermSet);
    centralityValues.push(symbol.centrality);
    degreeValues.push(degree);
    candidates.push({
      symbol,
      file,
      score: 0,
      distance,
      traversalBoost: traversalBoosts.get(symbolId) ?? 1,
      isPivot: pivot.pivotSymbolIds.has(symbolId),
      lexicalScore,
      degree,
    });
  }

  return {
    visited,
    candidates,
    ranked: [...candidates],
    batchDegrees,
    observationCountBySymbol,
    observationCountByFile,
    fileCache,
    pivotFileIds,
    pivotDirs,
    localityPivotDirs,
    rankingPivotDirs,
    centralityHubThreshold: quantile(centralityValues, 0.9),
    degreeHubThreshold: quantile(degreeValues, 0.9),
  };
}

function normalizeRetrievalPath(path: string, maxSegments: number): string {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.slice(-maxSegments).join("/");
}
