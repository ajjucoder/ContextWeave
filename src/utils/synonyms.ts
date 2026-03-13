const SYNONYM_MAP: Record<string, string[]> = {
  notification: ["toast", "alert", "banner", "snackbar", "message"],
  toast: ["notification", "alert", "snackbar"],
  auth: ["authentication", "authorization", "login", "signin", "sso", "oauth", "session", "token", "jwt", "credential"],
  authentication: ["auth", "authorization", "login", "signin", "session", "jwt", "credential"],
  authorization: ["auth", "authentication", "permission", "role", "access", "credential"],
  login: ["auth", "signin", "authentication", "session"],
  jwt: ["auth", "authentication", "token", "session", "oauth"],
  oauth: ["auth", "authentication", "jwt", "token", "sso"],
  user: ["account", "profile", "member"],
  error: ["exception", "fault", "failure", "panic", "throw", "catch", "crash"],
  exception: ["error", "fault", "failure", "throw", "catch", "panic"],
  throw: ["error", "exception", "panic", "raise"],
  modal: ["dialog", "popup", "overlay"],
  nav: ["navigation", "menu", "sidebar", "header"],
  route: ["router", "routing", "endpoint", "handler"],
  router: ["route", "routing", "middleware"],
  routing: ["route", "router", "middleware"],
  registration: ["register", "setup", "mount", "use"],
  register: ["registration", "mount", "use"],
  dispatch: ["handle", "handler", "invoke", "execute"],
  chain: ["flow", "pipeline", "stack"],
  compiler: ["compile", "validator", "controller"],
  validation: ["validate", "validator", "check", "sanitize", "schema"],
  config: ["configuration", "settings", "preferences", "options", "environment", "env", "flags"],
  db: ["database", "store", "repository", "repo", "sql", "orm", "query", "migration", "schema", "table", "model"],
  database: ["db", "sql", "orm", "store", "repository", "migration", "schema", "table", "model"],
  migration: ["db", "database", "schema", "orm", "upgrade", "rollback"],
  orm: ["db", "database", "model", "migration", "sql", "repository"],
  api: ["endpoint", "route", "handler", "controller", "rest", "graphql"],
  endpoint: ["api", "route", "handler", "controller"],
  cache: ["memoize", "memo", "memoization", "store", "redis", "ttl", "invalidate", "lru"],
  lru: ["cache", "memoize", "eviction", "ttl"],
  redis: ["cache", "queue", "pub", "sub", "broker"],
  validate: ["verify", "check", "sanitize", "schema"],
  entry: ["handler", "route", "request", "login"],
  lead: ["inquiry", "contact", "prospect"],
  capture: ["submit", "create", "intake", "form"],
  lifecycle: ["flow", "pipeline", "journey", "route"],
  inquiry: ["lead", "contact", "submission"],
  index: ["indexer", "indexproject", "scan"],
  parser: ["parse", "parsing", "parsefile", "parse-result"],
  generation: ["generate", "generator", "build", "compose"],
  scoring: ["score", "scorer", "ranking", "rank"],
  compression: ["compress", "compressor", "packing", "packer", "formatter"],
  capsule: ["context", "retrieval", "generator", "formatter"],
  bfs: ["weightedbfstraversal", "traversal", "graph", "hops"],
  traversal: ["bfs", "weightedbfstraversal", "search", "walk"],
  graph: ["bfs", "traversal", "neighbors", "hops"],
  symbol: ["function", "class", "variable", "method", "type", "interface"],
  queue: ["job", "worker", "broker", "task", "background", "celery", "sidekiq", "bull"],
  job: ["queue", "worker", "task", "background", "cron", "schedule"],
  worker: ["queue", "job", "background", "task", "consumer"],
  event: ["emit", "listener", "subscribe", "publish", "dispatch", "signal", "handler", "callback"],
  emit: ["event", "publish", "dispatch", "signal"],
  subscribe: ["event", "listen", "consume", "observe"],
  middleware: ["interceptor", "guard", "filter", "hook", "pipe"],
  interceptor: ["middleware", "guard", "filter", "hook"],
  guard: ["middleware", "interceptor", "auth", "permission"],
  state: ["store", "reducer", "context", "reactive", "signal", "atom", "zustand", "redux"],
  redux: ["state", "store", "reducer", "action", "dispatch"],
  zustand: ["state", "store", "atom", "reactive"],
  reducer: ["state", "redux", "store", "action"],
  ratelimit: ["throttle", "quota", "backoff", "limiter"],
  throttle: ["ratelimit", "quota", "backoff", "debounce"],
  test: ["spec", "describe", "it", "expect", "assert", "mock", "stub", "fixture"],
  deploy: ["deployment", "ci", "cd", "pipeline", "release", "build"],
  ci: ["deploy", "pipeline", "build", "test", "automation"],
  cd: ["deploy", "pipeline", "release", "automation"],
  pipeline: ["ci", "cd", "deploy", "flow", "chain", "stage"],
  architecture: ["design", "pattern", "structure", "system", "component", "module", "layer"],
  design: ["architecture", "pattern", "structure", "layout"],
  structure: ["architecture", "design", "pattern", "layout", "hierarchy"],
};

function getSynonyms(term: string): string[] {
  return SYNONYM_MAP[term.toLowerCase()] ?? [];
}

export function expandQueryWithSynonyms(queryTerms: string[]): string[] {
  const expanded = new Set(queryTerms.map((term) => term.toLowerCase()));

  for (const term of queryTerms) {
    const normalized = term.toLowerCase();
    const synonyms = getSynonyms(normalized);
    if (synonyms.length === 0) continue;

    for (const synonym of synonyms) {
      expanded.add(synonym.toLowerCase());
    }
  }

  return [...expanded];
}

export function buildQueryCoverageGroups(queryTerms: string[]): string[][] {
  return queryTerms.map((term) => {
    const normalized = term.toLowerCase();
    return [normalized, ...getSynonyms(normalized)];
  });
}
