const SYNONYM_MAP: Record<string, string[]> = {
  notification: ["toast", "alert", "banner", "snackbar", "message"],
  toast: ["notification", "alert", "snackbar"],
  auth: ["authentication", "login", "signin", "sso", "oauth", "session", "token", "jwt"],
  authentication: ["auth", "login", "signin", "session"],
  login: ["auth", "signin", "authentication", "session"],
  user: ["account", "profile", "member"],
  error: ["exception", "fault", "failure", "panic", "throw", "crash"],
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
  config: ["configuration", "settings", "preferences", "options", "env", "flags"],
  db: ["database", "store", "repository", "repo", "sql", "orm", "query"],
  database: ["db", "sql", "orm", "store", "repository"],
  api: ["endpoint", "route", "handler"],
  cache: ["memoize", "memo", "store", "redis", "ttl", "invalidate"],
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
  event: ["emit", "listener", "subscribe", "publish", "dispatch", "signal"],
  middleware: ["interceptor", "guard", "filter", "hook", "pipe"],
  state: ["store", "reducer", "context", "reactive", "signal", "zustand", "redux"],
  ratelimit: ["throttle", "quota", "backoff", "limiter"],
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
