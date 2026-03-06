import { normalizeRetrievalPath } from "../utils/path-retrieval.js";

export interface PivotCandidate {
  name: string;
  signature: string;
  kind: string;
  filePath: string;
}

export interface RankedPivots {
  ranked: Map<number, number>;
  scores: number[];
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
const ACTION_SIGNAL_TERMS = new Set([
  "submit",
  "create",
  "send",
  "load",
  "get",
  "save",
  "persist",
  "fetch",
  "update",
  "delete",
  "exchange",
  "verify",
  "handle",
  "route",
  "authenticate",
  "write",
  "read",
  "sync",
  "callback",
  "notify",
]);
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

export function scorePivotRelevance(candidate: PivotCandidate, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;

  const sigLower = candidate.signature.toLowerCase();
  const pathLower = normalizeRetrievalPath(candidate.filePath, 6).toLowerCase();
  const nameLower = candidate.name.toLowerCase();
  const kindLower = candidate.kind.toLowerCase();

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

  const nameTermHits = queryTerms.filter((term) =>
    nameTokens.some((t) => stemMatch(t, term))
  ).length;
  const sigTermHits = queryTerms.filter((term) => sigLower.includes(term)).length;
  const pathTermHits = queryTerms.filter((term) =>
    pathTokens.some((t) => stemMatch(t, term))
  ).length;

  if (nameTermHits === 0 && sigTermHits === 0 && pathTermHits === 0) return 0;

  const totalTerms = queryTerms.length;

  const nameCoverage = nameTermHits / totalTerms;
  const nameScore = nameTermHits * (1 + nameCoverage * 3);

  const sigCoverage = sigTermHits / totalTerms;
  const sigScore = sigTermHits * (1 + sigCoverage) * 0.5;

  const pathCoverage = pathTermHits / totalTerms;
  const pathScore = pathTermHits * (1 + pathCoverage) * 0.3;

  const kindWeight =
    kindLower === "function" || kindLower === "class" || kindLower === "method" ? 1.2 : 1.0;

  let score = (nameScore + sigScore + pathScore) * kindWeight;

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

  return score;
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
  maxPivots: number
): RankedPivots {
  const scored = candidates.map((c) => ({
    id: c.id,
    score: scorePivotRelevance(c, queryTerms),
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
  return { ranked, scores };
}
