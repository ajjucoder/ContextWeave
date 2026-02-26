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
  config: ["configuration", "settings", "preferences", "options"],
  db: ["database", "store", "repository", "repo"],
  api: ["endpoint", "route", "handler"],
  cache: ["memoize", "memo", "store"],
  validate: ["verify", "check", "sanitize"],
};

export function expandQueryWithSynonyms(queryTerms: string[]): string[] {
  const expanded = new Set(queryTerms.map((term) => term.toLowerCase()));

  for (const term of queryTerms) {
    const normalized = term.toLowerCase();
    const synonyms = SYNONYM_MAP[normalized];
    if (!synonyms) continue;

    for (const synonym of synonyms) {
      expanded.add(synonym.toLowerCase());
    }
  }

  return [...expanded];
}
