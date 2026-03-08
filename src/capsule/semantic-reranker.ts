import { splitIdentifier } from "../utils/camel-split.js";
import { stem } from "../utils/stemmer.js";

const SEMANTIC_CONCEPTS: Record<string, string[]> = {
  lead: ["inquiry", "submission", "contact"],
  capture: ["submit", "create", "persist", "request"],
  lifecycle: ["flow", "pipeline", "route", "handler", "service"],
  eligibility: ["approval", "rules", "policy", "partner", "program"],
  obligations: ["policy", "retention", "governance", "compliance"],
  compliance: ["policy", "rules", "enforcement", "retention"],
  governance: ["policy", "access", "retention", "control"],
  persistence: ["persist", "store", "save", "write", "database", "ledger"],
  callback: ["oauth", "handler", "route", "controller", "token"],
  discovery: ["index", "parse", "extract", "scan", "symbol"],
  loading: ["load", "fetch", "read", "detail", "session"],
  retrieval: ["search", "recall", "lookup", "query", "capsule"],
};

const UI_PATH_RE = /(^|[/\\])(ui|components?|views?|pages?)([/\\]|$)/i;
const UI_FOCUSED_TERMS = new Set(["ui", "ux", "component", "components", "view", "views", "page", "pages", "modal", "form"]);

export interface SemanticRerankItem<T> {
  item: T;
  id: number;
  name: string;
  signature: string;
  filePath: string;
  docComment: string | null;
  baseScore: number;
  isPivot: boolean;
  adjustedScore?: number;
}

export interface SemanticRerankResult<T> {
  ranked: SemanticRerankItem<T>[];
  applied: boolean;
  boosted: number;
  candidateCount: number;
}

interface SemanticFieldTokens {
  name: Set<string>;
  signature: Set<string>;
  path: Set<string>;
  doc: Set<string>;
  combined: Set<string>;
}

interface SemanticRerankOptions {
  queryTerms: string[];
  expandedTerms: string[];
  maxCandidates?: number;
  windowSize?: number;
  alpha?: number;
}

function normalizeToken(token: string): string | null {
  const compact = token.trim().toLowerCase();
  if (compact.length < 3) return null;
  return stem(compact);
}

function tokenize(text: string): Set<string> {
  const raw = text
    .split(/[^A-Za-z0-9]+/)
    .flatMap((segment) => [segment.toLowerCase(), ...splitIdentifier(segment)]);
  const normalized = raw
    .map(normalizeToken)
    .filter((token): token is string => token !== null);
  return new Set(normalized);
}

function expandSemanticTerms(terms: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const term of terms) {
    const normalized = normalizeToken(term);
    if (normalized) expanded.add(normalized);
    for (const related of SEMANTIC_CONCEPTS[term.toLowerCase()] ?? []) {
      const relatedToken = normalizeToken(related);
      if (relatedToken) expanded.add(relatedToken);
    }
  }
  return expanded;
}

function buildFieldTokens<T>(entry: SemanticRerankItem<T>): SemanticFieldTokens {
  const name = tokenize(entry.name);
  const signature = tokenize(entry.signature);
  const path = tokenize(entry.filePath);
  const doc = tokenize(entry.docComment ?? "");
  return {
    name,
    signature,
    path,
    doc,
    combined: new Set([...name, ...signature, ...path, ...doc]),
  };
}

function computeIdf(candidates: SemanticFieldTokens[]): Map<string, number> {
  const docFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    for (const token of candidate.combined) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  const total = Math.max(1, candidates.length);
  for (const [token, frequency] of docFrequency) {
    idf.set(token, Math.log(1 + total / (1 + frequency)));
  }
  return idf;
}

function scoreField(tokens: Set<string>, terms: Set<string>, idf: Map<string, number>): number {
  let score = 0;
  for (const term of terms) {
    if (tokens.has(term)) {
      score += idf.get(term) ?? 1;
    }
  }
  return score;
}

function hasTermMatch(tokens: Set<string>, terms: Set<string>): boolean {
  for (const term of terms) {
    if (tokens.has(term)) return true;
  }
  return false;
}

function computeSemanticScore(
  tokens: SemanticFieldTokens,
  primaryTerms: Set<string>,
  expandedTerms: Set<string>,
  idf: Map<string, number>
): number {
  const primaryScore =
    scoreField(tokens.name, primaryTerms, idf) * 0.45 +
    scoreField(tokens.signature, primaryTerms, idf) * 0.25 +
    scoreField(tokens.path, primaryTerms, idf) * 0.2 +
    scoreField(tokens.doc, primaryTerms, idf) * 0.1;

  const expandedOnly = new Set<string>([...expandedTerms].filter((term) => !primaryTerms.has(term)));
  const expandedScore =
    scoreField(tokens.name, expandedOnly, idf) * 0.18 +
    scoreField(tokens.signature, expandedOnly, idf) * 0.12 +
    scoreField(tokens.path, expandedOnly, idf) * 0.08 +
    scoreField(tokens.doc, expandedOnly, idf) * 0.05;

  return Math.tanh((primaryScore + expandedScore) / 3);
}

export function applySemanticRerank<T>(
  items: SemanticRerankItem<T>[],
  options: SemanticRerankOptions
): SemanticRerankResult<T> {
  const maxCandidates = options.maxCandidates ?? 64;
  const windowSize = options.windowSize ?? 8;
  const alpha = options.alpha ?? 0.16;
  const considered = items.slice(0, maxCandidates);
  if (considered.length === 0) {
    return { ranked: items, applied: false, boosted: 0, candidateCount: 0 };
  }

  const primaryTerms = expandSemanticTerms(options.queryTerms);
  const expandedTerms = expandSemanticTerms(options.expandedTerms);
  const queryUiFocused = options.queryTerms.some((term) => UI_FOCUSED_TERMS.has(term.toLowerCase()));
  const fieldTokens = considered.map((entry) => buildFieldTokens(entry));
  const idf = computeIdf(fieldTokens);
  const adjusted = considered.map((entry, index) => {
    const tokens = fieldTokens[index]!;
    const semanticScore = computeSemanticScore(tokens, primaryTerms, expandedTerms, idf);
    const exactAnchor = hasTermMatch(tokens.name, primaryTerms) || hasTermMatch(tokens.signature, primaryTerms);
    const semanticMissPenalty =
      primaryTerms.size > 0 && !hasTermMatch(tokens.combined, expandedTerms)
        ? 0.12
        : 0;
    const uiPathPenalty =
      !queryUiFocused && UI_PATH_RE.test(entry.filePath)
        ? 0.24
        : 0;
    return {
      ...entry,
      exactAnchor,
      semanticScore,
      adjustedScore: entry.baseScore * Math.max(0.1, 1 + alpha * semanticScore - semanticMissPenalty - uiPathPenalty),
    };
  });

  const reranked = [...adjusted];
  let applied = false;
  const boosted = adjusted.filter((entry) => entry.semanticScore > 0.05 && !entry.isPivot).length;

  if (adjusted.some((entry) => Math.abs(entry.adjustedScore - entry.baseScore) > 1e-6)) {
    applied = true;
  }

  for (let start = 0; start < adjusted.length; start += windowSize) {
    const window = adjusted.slice(start, start + windowSize);
    const movable = window
      .map((entry, offset) => ({ entry, offset }))
      .filter(({ entry }) => !(entry.isPivot && entry.exactAnchor));

    const reordered = [...movable].sort((a, b) => {
      if (b.entry.adjustedScore !== a.entry.adjustedScore) {
        return b.entry.adjustedScore - a.entry.adjustedScore;
      }
      if (b.entry.baseScore !== a.entry.baseScore) {
        return b.entry.baseScore - a.entry.baseScore;
      }
      return a.entry.id - b.entry.id;
    });

    for (let i = 0; i < movable.length; i++) {
      const original = movable[i]!;
      const replacement = reordered[i]!;
      if (original.entry.id !== replacement.entry.id) {
        applied = true;
      }
      reranked[start + original.offset] = replacement.entry;
    }
  }

  return {
    ranked: reranked,
    applied,
    boosted,
    candidateCount: considered.length,
  };
}
