import type Database from "better-sqlite3";
import { splitIdentifier } from "../utils/camel-split.js";
import type { ClassifiedQuery } from "./intent-classifier.js";

const STOP_WORDS = new Set(["a", "an", "the", "in", "on", "at", "for", "of", "with", "and", "or", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "can", "from", "to", "by", "as", "into", "about", "between", "through"]);

const MAX_TERMS_PER_GROUP = 3;
const MIN_TERMS_TO_SPLIT = 4;
const MAX_SMART_SUB_QUERIES = 4;
const FLOW_SPLIT_TERMS = new Set([
  "flow",
  "route",
  "routes",
  "handler",
  "handlers",
  "request",
  "response",
  "submission",
  "submit",
  "callback",
  "session",
  "auth",
  "oauth",
]);

const TASK_PATTERN_BUNDLES: Record<string, string[][]> = {
  find: [["error", "handling", "validation"], ["edge", "cases", "guards"], ["pipeline", "flow", "output"]],
  check: [["error", "handling", "validation"], ["edge", "cases", "guards"], ["pipeline", "flow", "output"]],
  debug: [["error", "handling", "validation"], ["edge", "cases", "guards"], ["pipeline", "flow", "output"]],
  investigate: [["error", "handling", "validation"], ["edge", "cases", "guards"], ["pipeline", "flow", "output"]],
  audit: [["error", "handling", "validation"], ["edge", "cases", "guards"], ["pipeline", "flow", "output"]],
  implement: [["registration", "server", "tool"], ["schema", "validation", "types"], ["integration", "handler", "tests"]],
  add: [["registration", "server", "tool"], ["schema", "validation", "types"], ["integration", "handler", "tests"]],
  create: [["registration", "server", "tool"], ["schema", "validation", "types"], ["integration", "handler", "tests"]],
  update: [["registration", "server", "tool"], ["schema", "validation", "types"], ["integration", "handler", "tests"]],
  migrate: [["registration", "server", "tool"], ["schema", "validation", "types"], ["integration", "handler", "tests"]],
  optimize: [["performance", "queries", "hotpaths"], ["cache", "latency", "loops"], ["index", "batch", "throughput"]],
  improve: [["performance", "queries", "hotpaths"], ["cache", "latency", "loops"], ["index", "batch", "throughput"]],
  refactor: [["interfaces", "types", "contracts"], ["modules", "boundaries", "dependencies"], ["tests", "coverage", "safety"]],
  review: [["tests", "coverage", "assertions"], ["interfaces", "types", "contracts"], ["error", "handling", "validation"]],
  test: [["tests", "coverage", "assertions"], ["fixtures", "mocks", "setup"], ["edge", "cases", "regression"]],
  fix: [["error", "handling", "validation"], ["edge", "cases", "guards"], ["pipeline", "flow", "output"]],
  remove: [["usages", "references", "imports"], ["cleanup", "orphaned", "unused"], ["tests", "coverage", "safety"]],
  delete: [["usages", "references", "imports"], ["cleanup", "orphaned", "unused"], ["tests", "coverage", "safety"]],
  replace: [["interfaces", "types", "contracts"], ["modules", "boundaries", "dependencies"], ["tests", "coverage", "safety"]],
  extract: [["interfaces", "types", "contracts"], ["modules", "boundaries", "dependencies"], ["tests", "coverage", "safety"]],
};

const DOMAIN_BUNDLES: Record<string, string[][]> = {
  auth: [["login", "session", "token"], ["password", "credential", "hash"], ["middleware", "guard", "permission"]],
  api: [["route", "handler", "controller"], ["endpoint", "middleware", "request"], ["response", "schema", "validation"]],
  db: [["query", "schema", "migration"], ["model", "table", "index"], ["connection", "pool", "transaction"]],
  ui: [["component", "props", "state"], ["render", "layout", "style"], ["event", "handler", "hook"]],
  test: [["fixture", "mock", "setup"], ["assertion", "expect", "coverage"], ["integration", "regression", "snapshot"]],
  capsule: [["generator", "packer", "formatter"], ["compression", "scoring", "budget"], ["pivot", "search", "retrieval"]],
  graph: [["bfs", "traversal", "graph"], ["weightedbfstraversal", "distance", "hops"], ["queue", "neighbors", "visited"]],
};

export interface SubQuery {
  terms: string[];
  targetClusterIds: number[];
  budgetFraction: number;
  priority: number;
}

export interface ClusterHint {
  id: number;
  terms: string[];
  relevance?: number;
}

export type DecomposedQueryGroups = string[][] & { idfWeights: Map<string, number> };

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function sanitizeTerms(terms: string[]): string[] {
  return uniq(
    terms
      .flatMap((term) => {
        const trimmed = term.trim();
        const splits = splitIdentifier(trimmed);
        const joined = splits.length > 1 ? [splits.join(""), ...splits.slice(1).map((_, index) => splits.slice(index + 1).join(""))] : [];
        return [trimmed, ...splits, ...joined];
      })
      .map((term) => term.toLowerCase().trim())
      .filter((term) => term.length > 1 && !STOP_WORDS.has(term))
  );
}

export function computeTermIDF(db: Database.Database, terms: string[]): Map<string, number> {
  const normalizedTerms = sanitizeTerms(terms);
  const weights = new Map<string, number>();
  if (normalizedTerms.length === 0) {
    return weights;
  }

  const totalFiles = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
  if (totalFiles === 0) {
    return new Map(normalizedTerms.map((term) => [term, 1]));
  }

  const countStmt = db.prepare(`
    SELECT COUNT(DISTINCT file_id) as c
    FROM symbols
    WHERE lower(name) LIKE '%' || ? || '%'
  `);
  for (const term of normalizedTerms) {
    const filesContaining = (countStmt.get(term) as { c: number }).c;
    weights.set(term, Math.log(totalFiles / (1 + filesContaining)));
  }
  return weights;
}

function termsLooselyOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length >= 5 && right.startsWith(left.slice(0, -1))) return true;
  if (right.length >= 5 && left.startsWith(right.slice(0, -1))) return true;
  return false;
}

function clusterMatchesBaseTerms(cluster: ClusterHint, baseTerms: string[]): boolean {
  const clusterTerms = sanitizeTerms(cluster.terms);
  return clusterTerms.some((clusterTerm) =>
    baseTerms.some((baseTerm) => termsLooselyOverlap(clusterTerm, baseTerm))
  );
}

function normalizeFractions(subQueries: Array<Omit<SubQuery, "budgetFraction"> & { weight: number }>): SubQuery[] {
  if (subQueries.length === 0) return [];
  const weightSum = subQueries.reduce((sum, q) => sum + Math.max(0.0001, q.weight), 0);

  return subQueries.map((q) => ({
    terms: q.terms,
    targetClusterIds: q.targetClusterIds,
    priority: q.priority,
    budgetFraction: Math.max(0, q.weight / weightSum),
  }));
}

function deriveTaskBundles(actionVerbs: string[], impliedModules: string[] = []): string[][] {
  if (impliedModules.length > 0) {
    const domainBundles: string[][] = [];
    for (const mod of impliedModules) {
      const modBundles = DOMAIN_BUNDLES[mod];
      if (!modBundles) continue;
      for (const bundle of modBundles) {
        const key = bundle.join("|");
        if (domainBundles.some((existing) => existing.join("|") === key)) continue;
        domainBundles.push(bundle);
        if (domainBundles.length >= MAX_SMART_SUB_QUERIES) return domainBundles;
      }
    }
    if (domainBundles.length > 0) return domainBundles;
  }

  const bundles: string[][] = [];

  for (const verb of actionVerbs) {
    const fromVerb = TASK_PATTERN_BUNDLES[verb];
    if (!fromVerb) continue;
    for (const bundle of fromVerb) {
      const key = bundle.join("|");
      if (bundles.some((existing) => existing.join("|") === key)) continue;
      bundles.push(bundle);
      if (bundles.length >= MAX_SMART_SUB_QUERIES) return bundles;
    }
  }

  if (bundles.length > 0) return bundles;

  return [
    ["architecture", "flow", "dependencies"],
    ["interfaces", "types", "validation"],
    ["tests", "coverage", "safety"],
  ];
}

function rankClusters(clusterHints: ClusterHint[]): ClusterHint[] {
  return [...clusterHints]
    .sort((a, b) => (b.relevance ?? 1) - (a.relevance ?? 1))
    .slice(0, MAX_SMART_SUB_QUERIES);
}

function buildBaseTerms(classified: ClassifiedQuery, fallbackQuery: string, db?: Database.Database): string[] {
  const candidates = sanitizeTerms([...classified.focusTerms, ...classified.normalizedTerms]);
  if (candidates.length > 0) return candidates;
  return mergeSubQueryTerms(decomposeQuery(fallbackQuery, db));
}

export function decomposeQuery(query: string, db?: Database.Database): DecomposedQueryGroups {
  const terms = sanitizeTerms(query.replace(/[^A-Za-z0-9_\s]/g, " ").split(/\s+/));
  const groups = [] as DecomposedQueryGroups;
  groups.idfWeights = db ? computeTermIDF(db, terms) : new Map(terms.map((term) => [term, 1]));

  if (terms.length === 0) return groups;
  if (terms.length < MIN_TERMS_TO_SPLIT) {
    groups.push(terms);
    return groups;
  }

  let i = 0;
  while (i < terms.length) {
    groups.push(terms.slice(i, i + MAX_TERMS_PER_GROUP));
    i += MAX_TERMS_PER_GROUP;
  }
  return groups;
}

export function mergeSubQueryTerms(groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const term of group) {
      if (!seen.has(term)) {
        seen.add(term);
        result.push(term);
      }
    }
  }
  return result;
}

export function decomposeForBroad(
  query: string,
  classified: ClassifiedQuery,
  clusterHints: ClusterHint[] = [],
  db?: Database.Database
): SubQuery[] {
  const baseTerms = buildBaseTerms(classified, query, db);
  const rankedClusters = rankClusters(clusterHints).filter((cluster) =>
    clusterMatchesBaseTerms(cluster, baseTerms)
  );

  if (rankedClusters.length > 0) {
    const weightedSubQueries = rankedClusters.map((cluster, index) => ({
      terms: sanitizeTerms([...baseTerms, ...cluster.terms]).slice(0, 8),
      targetClusterIds: [cluster.id],
      priority: index + 1,
      weight: cluster.relevance ?? 1,
    }));
    return normalizeFractions(weightedSubQueries);
  }

  const keepsFlowContext = baseTerms.some((term) => FLOW_SPLIT_TERMS.has(term));
  if (baseTerms.length <= 5 && !keepsFlowContext) {
    return [
      {
        terms: baseTerms,
        targetClusterIds: [],
        priority: 1,
        budgetFraction: 1,
      },
    ];
  }

  const grouped = decomposeQuery(baseTerms.join(" "), db);
  const selected = grouped.slice(0, MAX_SMART_SUB_QUERIES);
  if (selected.length === 0) return [];

  return normalizeFractions(
    selected.map((terms, index) => ({
      terms,
      targetClusterIds: [],
      priority: index + 1,
      weight: 1,
    }))
  );
}

export function decomposeForTask(
  query: string,
  classified: ClassifiedQuery,
  clusterHints: ClusterHint[] = [],
  db?: Database.Database
): SubQuery[] {
  const baseTerms = buildBaseTerms(classified, query, db);
  const bundles = deriveTaskBundles(classified.actionVerbs, classified.impliedModules).slice(0, MAX_SMART_SUB_QUERIES);
  const rankedClusters = rankClusters(clusterHints);
  const subQueryCount = Math.max(2, Math.min(MAX_SMART_SUB_QUERIES, Math.max(bundles.length, rankedClusters.length || 0)));

  const weightedSubQueries: Array<Omit<SubQuery, "budgetFraction"> & { weight: number }> = [];

  for (let i = 0; i < subQueryCount; i++) {
    const bundle = bundles[i] ?? bundles[bundles.length - 1] ?? [];
    const cluster = rankedClusters[i];
    const terms = sanitizeTerms([
      ...baseTerms,
      ...bundle,
      ...(cluster ? cluster.terms : []),
    ]).slice(0, 10);

    const clusterWeight = cluster?.relevance ?? 1;
    const priorityWeight = i === 0 ? 1.25 : i === 1 ? 1.1 : 1;
    weightedSubQueries.push({
      terms,
      targetClusterIds: cluster ? [cluster.id] : [],
      priority: i + 1,
      weight: clusterWeight * priorityWeight,
    });
  }

  return normalizeFractions(weightedSubQueries);
}
