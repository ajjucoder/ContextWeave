const SYNONYM_MAP: Record<string, string[]> = {
  notification: ["toast", "alert", "banner", "snackbar", "message"],
  toast: ["notification", "alert", "snackbar"],
  auth: ["authentication", "login", "signin", "sso", "oauth"],
  authentication: ["auth", "login", "signin"],
  login: ["auth", "signin", "authentication"],
  user: ["account", "profile", "member"],
  error: ["exception", "fault", "failure"],
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
  validation: ["validate", "validator", "check", "sanitize"],
  config: ["configuration", "settings", "preferences", "options"],
  db: ["database", "store", "repository", "repo"],
  api: ["endpoint", "route", "handler"],
  cache: ["memoize", "memo", "store"],
  validate: ["verify", "check", "sanitize"],
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
};

function getSynonyms(term: string): string[] {
  return SYNONYM_MAP[term.toLowerCase()] ?? [];
}

function getMorphVariants(term: string): string[] {
  const normalized = term.toLowerCase();
  const variants = new Set<string>();

  if (normalized.endsWith("ies") && normalized.length > 4) {
    variants.add(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith("es") && normalized.length > 4) {
    variants.add(normalized.slice(0, -2));
  }
  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 3) {
    variants.add(normalized.slice(0, -1));
  }

  if (!normalized.endsWith("s") && normalized.length > 3) {
    variants.add(`${normalized}s`);
  }
  if (normalized.endsWith("y") && normalized.length > 3) {
    variants.add(`${normalized.slice(0, -1)}ies`);
  }

  variants.delete(normalized);
  return [...variants];
}

export function expandQueryWithSynonyms(queryTerms: string[]): string[] {
  const expanded = new Set(queryTerms.map((term) => term.toLowerCase()));

  for (const term of queryTerms) {
    const normalized = term.toLowerCase();
    for (const variant of getMorphVariants(normalized)) {
      expanded.add(variant);
    }
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
