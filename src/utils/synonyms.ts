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
