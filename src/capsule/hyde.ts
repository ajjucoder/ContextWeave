const CAMEL_CASE_RE = /[a-z][A-Z]/;
const SNAKE_CASE_RE = /[a-z]_[a-z]/;
const DOT_NOTATION_RE = /\w+\.\w+/;

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "shall",
  "of", "in", "to", "for", "with", "on", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "about",
  "between", "under", "above", "and", "or", "but", "not", "no",
  "this", "that", "these", "those", "it", "its", "my", "your",
  "i", "we", "you", "they", "he", "she",
]);

const VERB_MAP: Record<string, string> = {
  authenticate: "authenticate",
  authentication: "authenticate",
  auth: "authenticate",
  login: "login",
  validate: "validate",
  validation: "validate",
  handle: "handle",
  process: "process",
  processing: "process",
  create: "create",
  creating: "create",
  update: "update",
  updating: "update",
  delete: "delete",
  deleting: "delete",
  fetch: "fetch",
  fetching: "fetch",
  load: "load",
  loading: "load",
  render: "render",
  rendering: "render",
  parse: "parse",
  parsing: "parse",
  transform: "transform",
  transforming: "transform",
  submit: "submit",
  submitting: "submit",
  send: "send",
  sending: "send",
  receive: "receive",
  receiving: "receive",
  connect: "connect",
  connecting: "connect",
  disconnect: "disconnect",
  initialize: "initialize",
  initializing: "initialize",
  configure: "configure",
  configuring: "configure",
  manage: "manage",
  managing: "manage",
  schedule: "schedule",
  scheduling: "schedule",
};

export function isNaturalLanguageQuery(query: string): boolean {
  if (CAMEL_CASE_RE.test(query)) return false;
  if (SNAKE_CASE_RE.test(query)) return false;
  if (DOT_NOTATION_RE.test(query)) return false;

  const words = query.trim().split(/\s+/);
  if (words.length <= 2) return false;

  const contentWords = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  return contentWords.length >= 2;
}

export function expandToHypothetical(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  let verb = "handle";
  const nouns: string[] = [];

  for (const word of words) {
    const mapped = VERB_MAP[word];
    if (mapped) {
      verb = mapped;
    } else {
      nouns.push(word);
    }
  }

  if (nouns.length === 0) {
    return query;
  }

  const functionName = verb + nouns.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join("");
  const paramName = nouns[0] ?? "input";
  const docstring = `${verb} ${nouns.join(" ")} - ${query}`;

  return `function ${functionName}(${paramName}: any): any { /* ${docstring} */ }`;
}
