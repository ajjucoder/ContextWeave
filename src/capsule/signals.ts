export function termWeight(term: string, idfWeights?: Map<string, number>): number {
  const raw = idfWeights?.get(term.toLowerCase()) ?? 1;
  return raw < 0.5 ? raw * 0.5 : raw;
}

export const ACTION_SIGNAL_TERMS = new Set([
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

export const EXTENDED_ACTION_SIGNAL_TERMS = new Set([
  ...ACTION_SIGNAL_TERMS,
  "parse",
  "transform",
  "compile",
  "dispatch",
]);

export const RUNTIME_QUERY_TERMS = new Set([
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

export const UI_COMPONENT_PATH_RE = /(^|[/\\])(ui|components?|views?|pages?|templates?|marketing)([/\\]|$)/i;
export const PAGE_ENTRY_PATH_RE = /(^|[/\\])(page|layout)\.[cm]?[jt]sx?$/i;
export const TYPE_DECLARATION_RE = /(^|[/\\])types?([/\\]|$)|\.d\.ts$|(^|[/\\])types?\.[cm]?[jt]sx?$/i;
export const TYPE_DECLARATION_PATH_RE = TYPE_DECLARATION_RE;
export const RUNTIME_CODE_PATH_RE = /(^|[/\\])(src|lib|server|app|api|routes?|controllers?|services?)([/\\]|$)/i;

export function isUiLikePath(filePath: string): boolean {
  return UI_COMPONENT_PATH_RE.test(filePath) || PAGE_ENTRY_PATH_RE.test(filePath);
}
