export type QueryIntent = "narrow" | "broad" | "task";

export interface ClassifiedQuery {
  intent: QueryIntent;
  normalizedTerms: string[];
  focusTerms: string[];
  actionVerbs: string[];
  impliedModules: string[];
  suggestedBudgetMultiplier: number;
}

interface Token {
  raw: string;
  normalized: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "in",
  "on",
  "at",
  "for",
  "of",
  "with",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  "from",
  "to",
  "by",
  "as",
  "into",
  "about",
  "between",
  "through",
  "this",
  "that",
  "these",
  "those",
  "new",
]);

export const TASK_VERBS = new Set([
  "find",
  "check",
  "implement",
  "add",
  "fix",
  "optimize",
  "refactor",
  "debug",
  "review",
  "test",
  "remove",
  "update",
  "create",
  "delete",
  "improve",
  "investigate",
  "audit",
  "migrate",
  "replace",
  "extract",
  "how",
  "what",
  "why",
]);

export const MODULE_SYNONYMS: Record<string, string[]> = {
  auth: ["authentication", "login", "session", "token", "jwt", "password", "credential"],
  db: ["database", "query", "sql", "schema", "migration", "table", "index"],
  api: ["endpoint", "route", "handler", "request", "response", "middleware", "controller"],
  ui: ["component", "view", "page", "template", "render", "layout", "style"],
  test: ["spec", "assert", "mock", "fixture", "coverage", "validation"],
  capsule: ["generator", "packer", "formatter", "compression", "scoring"],
};

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function tokenize(query: string): Token[] {
  return query
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .split(/\s+/)
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 1)
    .map((raw) => ({ raw, normalized: raw.toLowerCase() }));
}

function isSignalToken(token: Token): boolean {
  return /[A-Z]/.test(token.raw) || token.raw.includes("_") || token.normalized.length >= 7;
}

function inferModules(terms: string[]): string[] {
  const implied: string[] = [];

  for (const term of terms) {
    for (const [moduleName, synonyms] of Object.entries(MODULE_SYNONYMS)) {
      if (term === moduleName || synonyms.includes(term)) {
        implied.push(moduleName);
      }
    }
  }

  return uniq(implied);
}

function classifyIntent(actionVerbs: string[], normalizedTerms: string[]): QueryIntent {
  if (actionVerbs.length > 0) return "task";
  if (normalizedTerms.length <= 2) return "narrow";
  if (normalizedTerms.length >= 4) return "broad";
  return "narrow";
}

function budgetMultiplier(intent: QueryIntent): number {
  if (intent === "narrow") return 1.0;
  if (intent === "broad") return 1.5;
  return 2.0;
}

export function classifyQueryIntent(query: string): ClassifiedQuery {
  const tokens = tokenize(query);

  const filtered = tokens.filter((token) => !STOP_WORDS.has(token.normalized));
  const actionVerbs = uniq(filtered.filter((token) => TASK_VERBS.has(token.normalized)).map((token) => token.normalized));
  const normalizedTerms = uniq(
    filtered
      .filter((token) => !TASK_VERBS.has(token.normalized))
      .map((token) => token.normalized)
  );

  const intent = classifyIntent(actionVerbs, normalizedTerms);

  const signalTerms = uniq(
    filtered
      .filter((token) => !TASK_VERBS.has(token.normalized) && isSignalToken(token))
      .map((token) => token.normalized)
  );

  const fallbackFocusCount = intent === "task" ? 3 : 2;
  const focusTerms = signalTerms.length > 0 ? signalTerms : normalizedTerms.slice(0, fallbackFocusCount);

  return {
    intent,
    normalizedTerms,
    focusTerms,
    actionVerbs,
    impliedModules: inferModules(normalizedTerms),
    suggestedBudgetMultiplier: budgetMultiplier(intent),
  };
}
