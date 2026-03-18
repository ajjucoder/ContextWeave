import { normalizeRetrievalPath } from "../utils/path-retrieval.js";
import { ACTION_SIGNAL_TERMS, termWeight } from "./signals.js";

export interface PivotCandidate {
  name: string;
  signature: string;
  kind: string;
  filePath: string;
}

export interface RankedPivots {
  ranked: Map<number, number>;
  scores: number[];
  scored: Array<{ id: number; score: number; exactNameMatch: boolean }>;
}

interface PivotRelevance {
  score: number;
  exactNameMatch: boolean;
}

const FRAMEWORK_ENTRY_RE = /(^|\/)app\/.+\/route\.[cm]?[jt]sx?$/i;
const ROUTE_PATH_RE = /(^|\/)(api|routes?)(\/|$)/i;
const SERVER_PATH_RE = /(^|\/)(server|services?|controllers?|auth|db|data|repositories?|stores?|models?)(\/|$)/i;
const CLIENT_PATH_RE = /(^|\/)lib\/client(\/|$)/i;
const PAGE_PATH_RE = /(^|\/)(page|layout)\.[cm]?[jt]sx?$/i;
const COMPONENT_PATH_RE = /(^|\/)(components?|templates?|marketing)(\/|$)/i;
const VIEW_PATH_RE = /(^|\/)views?(\/|$)/i;
const CONFIG_PATH_RE =
  /(^|\/)(\.github|\.circleci|\.vscode|\.husky)(\/|$)|(^|\/)(package\.json|tsconfig\.json|eslint\.config|vite\.config|vitest\.config|jest\.config|tailwind\.config|postcss\.config)|\/\.eslintrc/i;
const TYPE_DECLARATION_RE = /(^|\/)types?(\/|$)|\.d\.ts$/i;
const UI_NAME_RE =
  /(hero|faq|tabs?|timeline|header|banner|testimonial|view|card|modal|panel|avatar|badge|skeleton|placeholder)/i;
const CONFIG_QUERY_TERMS = new Set([
  "config",
  "configuration",
  "settings",
  "workflow",
  "workflows",
  "github",
  "actions",
  "action",
  "ci",
  "build",
  "lint",
  "release",
  "deploy",
  "deployment",
  "package",
  "manifest",
  "tsconfig",
  "eslint",
  "prettier",
  "tailwind",
  "postcss",
  "vite",
  "vitest",
  "jest",
]);
const TYPE_QUERY_TERMS = new Set([
  "type",
  "types",
  "typing",
  "interface",
  "interfaces",
  "generic",
  "generics",
  "declaration",
  "declarations",
  "typedef",
  "typedefs",
  "signature",
  "signatures",
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
  "schema",
  "server",
  "service",
  "session",
  "stack",
  "validation",
  "validator",
]);
const RUNTIME_CODE_PATH_RE = /(^|\/)(src|lib|server|app|api|routes?|controllers?|services?)(\/|$)/i;

function extractSignalTokens(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function stemMatch(token: string, term: string): boolean {
  if (token.includes(term) || term.includes(token)) return true;
  const prefixLen = Math.min(token.length, term.length);
  for (let i = 0; i < prefixLen; i++) {
    if (token[i] !== term[i]) return i >= Math.min(5, prefixLen);
  }
  return true;
}

function describePivotRelevance(
  candidate: PivotCandidate,
  queryTerms: string[],
  idfWeights?: Map<string, number>
): PivotRelevance {
  if (queryTerms.length === 0) {
    return { score: 0, exactNameMatch: false };
  }

  const sigLower = (candidate.signature ?? "").toLowerCase();
  const pathLower = normalizeRetrievalPath(candidate.filePath, 6).toLowerCase();
  const nameLower = candidate.name.toLowerCase();
  const kindLower = candidate.kind.toLowerCase();
  const normalizedQueryTerms = queryTerms.map((term) => term.toLowerCase()).filter(Boolean);
  const expandedQueryTerms = new Set<string>();
  for (const term of normalizedQueryTerms) {
    expandedQueryTerms.add(term);
    for (const token of extractSignalTokens(term)) {
      expandedQueryTerms.add(token);
    }
  }

  const nameTokens = candidate.name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const pathTokens = pathLower
    .replace(/[_\-./\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const canonicalPathSegments = pathLower
    .split("/")
    .map((segment) => segment.replace(/\.[^.]+$/, ""))
    .map((segment) => segment.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
  const canonicalQueryTerms = normalizedQueryTerms
    .map((term) => term.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);

  const exactCaseInsensitiveMatch = normalizedQueryTerms.some((term) => term === nameLower);
  const camelCaseMatch = nameTokens.length > 1 && nameTokens.every((token) => expandedQueryTerms.has(token));
  const pathSegmentMatch = canonicalQueryTerms.some((term) => canonicalPathSegments.includes(term));
  const exactNameMatch = exactCaseInsensitiveMatch || camelCaseMatch || pathSegmentMatch;

  const weightedNameHits = queryTerms.reduce(
    (sum, term) => sum + (nameTokens.some((t) => stemMatch(t, term)) ? termWeight(term, idfWeights) : 0),
    0
  );
  const weightedSigHits = queryTerms.reduce(
    (sum, term) => sum + (sigLower.includes(term) ? termWeight(term, idfWeights) : 0),
    0
  );
  const weightedPathHits = queryTerms.reduce(
    (sum, term) => sum + (pathTokens.some((t) => stemMatch(t, term)) ? termWeight(term, idfWeights) : 0),
    0
  );

  if (weightedNameHits === 0 && weightedSigHits === 0 && weightedPathHits === 0 && !exactNameMatch) {
    return { score: 0, exactNameMatch: false };
  }

  const totalTermWeight = Math.max(
    queryTerms.reduce((sum, term) => sum + termWeight(term, idfWeights), 0),
    1
  );

  const nameCoverage = weightedNameHits / totalTermWeight;
  const nameScore = weightedNameHits * (1 + nameCoverage * 3);

  const sigCoverage = weightedSigHits / totalTermWeight;
  const sigScore = weightedSigHits * (1 + sigCoverage) * 0.5;

  const pathCoverage = weightedPathHits / totalTermWeight;
  const pathScore = weightedPathHits * (1 + pathCoverage) * 0.3;

  const HTTP_METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "head", "options"]);
  const isHttpMethodQuery = normalizedQueryTerms.length === 1 && HTTP_METHOD_NAMES.has(normalizedQueryTerms[0]!);
  const httpMethodKindBoost =
    isHttpMethodQuery && (kindLower === "function" || kindLower === "method") ? 3.0 : 1.0;
  const kindWeight =
    kindLower === "function" || kindLower === "class" || kindLower === "method" ? 1.2 : 1.0;

  let score = (nameScore + sigScore + pathScore) * kindWeight * httpMethodKindBoost;

  const signalTokens = new Set([
    ...extractSignalTokens(candidate.name),
    ...extractSignalTokens(candidate.signature),
  ]);
  const hasActionSignal = [...signalTokens].some((token) => ACTION_SIGNAL_TERMS.has(token));
  const isComponentPath = COMPONENT_PATH_RE.test(pathLower);
  const isViewPath = VIEW_PATH_RE.test(pathLower);
  const isConfigPath = CONFIG_PATH_RE.test(pathLower);
  const isUiNoiseName = UI_NAME_RE.test(nameLower);
  const configFocusedQuery = queryTerms.some((term) => CONFIG_QUERY_TERMS.has(term));
  const typeFocusedQuery = queryTerms.some((term) => TYPE_QUERY_TERMS.has(term));
  const runtimeFocusedQuery = queryTerms.some((term) => RUNTIME_QUERY_TERMS.has(term));

  if (FRAMEWORK_ENTRY_RE.test(pathLower)) {
    score += 3.5;
  } else if (ROUTE_PATH_RE.test(pathLower)) {
    score += 2.4;
  } else if (SERVER_PATH_RE.test(pathLower)) {
    score += 1.8;
  } else if (CLIENT_PATH_RE.test(pathLower)) {
    score += 1.2;
  } else if (PAGE_PATH_RE.test(pathLower)) {
    score += 1.4;
  }

  if (runtimeFocusedQuery && RUNTIME_CODE_PATH_RE.test(pathLower)) {
    score += 1.4;
  }

  if (hasActionSignal) {
    score += 0.8;
  }

  if (kindLower === "variable" && !hasActionSignal) {
    score *= 0.6;
  }

  if (isViewPath) {
    score *= hasActionSignal ? 0.2 : 0.08;
  } else if (isComponentPath) {
    score *= hasActionSignal ? 0.75 : 0.3;
  }

  if (isUiNoiseName) {
    score *= hasActionSignal ? 0.85 : 0.45;
  }

  if (isConfigPath && !configFocusedQuery) {
    score *= 0.08;
  }

  if (TYPE_DECLARATION_RE.test(pathLower) && !typeFocusedQuery) {
    score *= runtimeFocusedQuery ? 0.05 : 0.22;
  }

  const nameIdf = idfWeights?.get(nameLower) ?? idfWeights?.get(candidate.name) ?? 3;
  const isCommonName = nameIdf < 1.5;
  const commonNameDampener = isCommonName ? 0.15 : 1;

  if (exactCaseInsensitiveMatch) {
    const isSingleTermWholeQuery = normalizedQueryTerms.length === 1;
    score += (isSingleTermWholeQuery ? 100 : 50) * commonNameDampener;
  }
  if (camelCaseMatch) {
    score += 25 * commonNameDampener;
  }
  if (pathSegmentMatch) {
    score += 10;
  }

  return { score, exactNameMatch };
}

export function scorePivotRelevance(
  candidate: PivotCandidate,
  queryTerms: string[],
  idfWeights?: Map<string, number>
): number {
  return describePivotRelevance(candidate, queryTerms, idfWeights).score;
}

export function rankPivots(
  candidates: Array<{ id: number } & PivotCandidate>,
  queryTerms: string[],
  maxPivots: number
): Map<number, number> {
  return rankPivotsWithScores(candidates, queryTerms, maxPivots).ranked;
}

export function rankPivotsWithScores(
  candidates: Array<{ id: number } & PivotCandidate>,
  queryTerms: string[],
  maxPivots: number,
  idfWeights?: Map<string, number>
): RankedPivots {
  const scored = candidates.map((c) => ({
    id: c.id,
    ...describePivotRelevance(c, queryTerms, idfWeights),
  }));

  scored.sort((a, b) => b.score - a.score);

  const ranked = new Map<number, number>();
  const scores: number[] = [];
  for (const { id, score } of scored.slice(0, maxPivots)) {
    if (score > 0) {
      ranked.set(id, score);
      scores.push(score);
    }
  }
  return {
    ranked,
    scores,
    scored: scored.filter((entry) => entry.score > 0).slice(0, maxPivots),
  };
}
