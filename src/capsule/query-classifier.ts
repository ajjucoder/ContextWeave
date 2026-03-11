// query-classifier.ts — richer intent taxonomy for semantic-aware retrieval.
// Complements the existing intent-classifier.ts (narrow/broad/task/debug) with
// domain-aware intents and per-intent scoring weights.

export type QueryIntent =
  | "symbol_lookup"
  | "flow_trace"
  | "architectural"
  | "conceptual"
  | "implementation"
  | "broad";

export interface RetrievalStrategy {
  intent: QueryIntent;
  /** Boost multiplier for centrality-scored symbols (PageRank weight) */
  centralityWeight: number;
  /** Boost multiplier for BM25 text-match score */
  textMatchWeight: number;
  /** Boost multiplier for direct call-chain neighbors */
  callChainWeight: number;
  /** Max BFS depth to traverse */
  maxBfsDepth: number;
  /** Whether to apply negative-pattern filtering */
  applyNegativePatterns: boolean;
  /** Whether to expand query with synonym-aware BM25 terms */
  expandSynonyms: boolean;
  /** Token budget multiplier relative to default */
  budgetMultiplier: number;
}

export interface ClassifiedQuery {
  intent: QueryIntent;
  /** Normalised content terms (stop-words removed, lower-cased, deduped) */
  normalizedTerms: string[];
  /** Highest-signal terms for focused BFS seeding */
  focusTerms: string[];
  /** Code-pattern labels detected (e.g. "error_handling", "rate_limiting") */
  codePatterns: string[];
  /** Negative filter patterns — symbol names matching these should score 0 */
  negativePatterns: RegExp[];
  /** Per-intent retrieval config */
  strategy: RetrievalStrategy;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "for", "of", "with", "and", "or",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "must", "can", "from", "to", "by", "as", "into", "about", "between",
  "through", "this", "that", "these", "those", "new", "using", "use",
  "show", "me", "get", "give", "list",
]);

const QUESTION_WORDS = new Set(["how", "what", "why", "where", "when", "which"]);

const FLOW_KEYWORDS = new Set([
  "flow", "pipeline", "chain", "sequence", "lifecycle", "journey",
  "trace", "traces", "tracing", "propagate", "propagation",
  "call", "calls", "callers", "callsite", "invocation",
]);

const ARCHITECTURAL_KEYWORDS = new Set([
  "architecture", "design", "pattern", "structure", "system", "overview",
  "topology", "layout", "boundary", "layer", "layers", "module", "modules",
  "dependency", "dependencies", "coupling", "cohesion", "abstraction",
]);

const CONCEPTUAL_KEYWORDS = new Set([
  "explain", "understand", "concept", "idea", "purpose", "intent",
  "meaning", "description", "overview", "summary",
  "end-to-end", "high-level", "big-picture",
]);

const IMPLEMENTATION_KEYWORDS = new Set([
  "implement", "build", "create", "write", "add", "fix", "refactor",
  "update", "change", "modify", "extend", "enhance", "improve",
  "optimize", "migrate", "remove", "delete", "extract",
]);

// camelCase or PascalCase single-token heuristic
const CAMEL_OR_PASCAL_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*[A-Z][a-zA-Z0-9_$]*$/;
const IDENTIFIER_ONLY_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

// ---------------------------------------------------------------------------
// Code-pattern detection
// ---------------------------------------------------------------------------

interface PatternSpec {
  label: string;
  /** Terms that trigger this pattern when any match */
  triggerTerms: string[];
  /** Negative patterns for result filtering (symbol names to exclude) */
  negativeNameFragments: string[];
}

const CODE_PATTERNS: PatternSpec[] = [
  {
    label: "error_handling",
    triggerTerms: ["error", "exception", "catch", "throw", "recover", "fault", "failure", "panic"],
    negativeNameFragments: ["handleTimestampClick", "handleMouseClick", "onClick", "onPress", "handleChange"],
  },
  {
    label: "auth",
    triggerTerms: ["auth", "authentication", "login", "session", "token", "jwt", "oauth", "sso", "credential", "password"],
    negativeNameFragments: [],
  },
  {
    label: "rate_limiting",
    triggerTerms: ["ratelimit", "rate_limit", "throttle", "throttling", "quota", "backoff", "retry"],
    negativeNameFragments: [],
  },
  {
    label: "caching",
    triggerTerms: ["cache", "caching", "memo", "memoize", "memoisation", "ttl", "evict", "invalidate"],
    negativeNameFragments: [],
  },
  {
    label: "database",
    triggerTerms: ["db", "database", "query", "sql", "orm", "schema", "migration", "transaction", "index", "table"],
    negativeNameFragments: [],
  },
  {
    label: "queue",
    triggerTerms: ["queue", "job", "worker", "task", "schedule", "publish", "consume", "broker", "kafka", "rabbitmq", "sqs"],
    negativeNameFragments: [],
  },
  {
    label: "event",
    triggerTerms: ["event", "emit", "listener", "subscribe", "dispatch", "pubsub", "bus"],
    negativeNameFragments: [],
  },
  {
    label: "middleware",
    triggerTerms: ["middleware", "interceptor", "guard", "filter", "plugin", "hook", "next"],
    negativeNameFragments: [],
  },
  {
    label: "validation",
    triggerTerms: ["validate", "validation", "schema", "sanitize", "constraint", "rule", "zod", "yup", "joi"],
    negativeNameFragments: [],
  },
  {
    label: "state_management",
    triggerTerms: ["state", "store", "reducer", "action", "dispatch", "context", "redux", "zustand", "signal"],
    negativeNameFragments: [],
  },
  {
    label: "config",
    triggerTerms: ["config", "configuration", "env", "environment", "settings", "options", "flags", "feature-flag"],
    negativeNameFragments: [],
  },
  {
    label: "ui_rendering",
    triggerTerms: ["render", "component", "view", "page", "template", "layout", "widget", "jsx", "tsx"],
    negativeNameFragments: [],
  },
];

// ---------------------------------------------------------------------------
// Tokenisation helpers
// ---------------------------------------------------------------------------

function tokenize(query: string): string[] {
  return query
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .map((t) => t.toLowerCase());
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function isSignalToken(token: string): boolean {
  return /[A-Z]/.test(token) || token.includes("_") || token.length >= 7;
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

function detectCodePatterns(terms: string[], rawQuery: string): { labels: string[]; negativePatterns: RegExp[] } {
  const queryLower = rawQuery.toLowerCase();
  const labels: string[] = [];
  const negFragments = new Set<string>();

  for (const spec of CODE_PATTERNS) {
    const matched = spec.triggerTerms.some(
      (t) => terms.includes(t) || queryLower.includes(t)
    );
    if (matched) {
      labels.push(spec.label);
      for (const frag of spec.negativeNameFragments) {
        negFragments.add(frag);
      }
    }
  }

  const negativePatterns = [...negFragments].map(
    (frag) => new RegExp(frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
  );

  return { labels, negativePatterns };
}

// ---------------------------------------------------------------------------
// Intent classification
// ---------------------------------------------------------------------------

function classifyIntent(
  terms: string[],
  rawQuery: string,
  hasQuestionWord: boolean
): QueryIntent {
  const trimmed = rawQuery.trim();

  // Single identifier (no spaces) → symbol lookup
  if (!trimmed.includes(" ") && IDENTIFIER_ONLY_RE.test(trimmed)) {
    return "symbol_lookup";
  }

  // camelCase/PascalCase token among terms → likely a symbol name
  const rawTerms = rawQuery.split(/\s+/);
  if (rawTerms.length <= 2 && rawTerms.some((t) => CAMEL_OR_PASCAL_RE.test(t))) {
    return "symbol_lookup";
  }

  // Flow trace: explicit trace/propagation/call-chain language
  if (terms.some((t) => FLOW_KEYWORDS.has(t))) {
    return "flow_trace";
  }

  // Implementation: action-verb intent takes priority over architectural
  // (e.g. "refactor the database query layer" → implementation, not architectural)
  if (terms.some((t) => IMPLEMENTATION_KEYWORDS.has(t))) {
    return "implementation";
  }

  // Architectural: high-level structure keywords
  if (terms.some((t) => ARCHITECTURAL_KEYWORDS.has(t))) {
    return "architectural";
  }

  // Conceptual: explain/understand/concept with question words
  if (hasQuestionWord || terms.some((t) => CONCEPTUAL_KEYWORDS.has(t))) {
    if (terms.length <= 3) return "conceptual";
    return "broad";
  }

  // Default to broad for longer multi-term queries
  if (terms.length >= 4) return "broad";
  return "conceptual";
}

// ---------------------------------------------------------------------------
// Retrieval strategy factory
// ---------------------------------------------------------------------------

const STRATEGIES: Record<QueryIntent, RetrievalStrategy> = {
  symbol_lookup: {
    intent: "symbol_lookup",
    centralityWeight: 0.2,
    textMatchWeight: 2.0,
    callChainWeight: 1.0,
    maxBfsDepth: 2,
    applyNegativePatterns: false,
    expandSynonyms: false,
    budgetMultiplier: 0.75,
  },
  flow_trace: {
    intent: "flow_trace",
    centralityWeight: 0.5,
    textMatchWeight: 1.0,
    callChainWeight: 2.5,
    maxBfsDepth: 5,
    applyNegativePatterns: true,
    expandSynonyms: false,
    budgetMultiplier: 1.5,
  },
  architectural: {
    intent: "architectural",
    centralityWeight: 2.0,
    textMatchWeight: 0.8,
    callChainWeight: 1.0,
    maxBfsDepth: 3,
    applyNegativePatterns: true,
    expandSynonyms: true,
    budgetMultiplier: 1.75,
  },
  conceptual: {
    intent: "conceptual",
    centralityWeight: 1.0,
    textMatchWeight: 1.5,
    callChainWeight: 0.5,
    maxBfsDepth: 2,
    applyNegativePatterns: false,
    expandSynonyms: true,
    budgetMultiplier: 1.0,
  },
  implementation: {
    intent: "implementation",
    centralityWeight: 0.5,
    textMatchWeight: 1.5,
    callChainWeight: 1.5,
    maxBfsDepth: 3,
    applyNegativePatterns: true,
    expandSynonyms: false,
    budgetMultiplier: 1.5,
  },
  broad: {
    intent: "broad",
    centralityWeight: 1.5,
    textMatchWeight: 1.0,
    callChainWeight: 1.0,
    maxBfsDepth: 4,
    applyNegativePatterns: true,
    expandSynonyms: true,
    budgetMultiplier: 2.0,
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function classifyQuery(query: string): ClassifiedQuery {
  const rawTerms = tokenize(query);
  const filtered = rawTerms.filter((t) => !STOP_WORDS.has(t));
  const hasQuestionWord = filtered.some((t) => QUESTION_WORDS.has(t));
  const contentTerms = uniq(filtered.filter((t) => !QUESTION_WORDS.has(t)));

  const intent = classifyIntent(contentTerms, query, hasQuestionWord);

  const signalTerms = contentTerms.filter((t) => isSignalToken(t));
  const focusTerms = signalTerms.length > 0 ? signalTerms.slice(0, 5) : contentTerms.slice(0, 3);

  const { labels: codePatterns, negativePatterns } = detectCodePatterns(contentTerms, query);

  return {
    intent,
    normalizedTerms: contentTerms,
    focusTerms,
    codePatterns,
    negativePatterns,
    strategy: STRATEGIES[intent],
  };
}

/** Apply negative-pattern filtering to a list of symbol names. */
export function applyNegativeFilters(
  symbolNames: string[],
  negativePatterns: RegExp[]
): string[] {
  if (negativePatterns.length === 0) return symbolNames;
  return symbolNames.filter(
    (name) => !negativePatterns.some((re) => re.test(name))
  );
}

/** Return the RetrievalStrategy for a given intent without full classification. */
export function getStrategy(intent: QueryIntent): RetrievalStrategy {
  return STRATEGIES[intent];
}
