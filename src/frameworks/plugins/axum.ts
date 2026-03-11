import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

const ACTIX_ROUTE_RE = /#\[(?:get|post|put|patch|delete|options)\s*\(\s*"([^"]+)"\s*\)\]/g;

function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}

function extractAxumMethod(routeCall: string): string {
  const match = routeCall.match(/\b(get|post|put|patch|delete|options)\s*\(/);
  return (match?.[1] ?? "get").toUpperCase();
}

export const axumFrameworkPlugin: FrameworkTracePlugin = {
  id: "axum",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "rust") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const axumRe = /\.route\s*\(\s*"([^"]+)"\s*,\s*((?:get|post|put|patch|delete|options)\s*\(([A-Za-z_][\w:]*)\))/g;
      for (const match of symbol.fullSource.matchAll(axumRe)) {
        const routePath = match[1] ?? "";
        const routeCall = match[2] ?? "";
        const handlerRef = match[3] ?? "";
        const targetName = handlerRef.split("::").pop() ?? handlerRef;
        const httpMethod = extractAxumMethod(routeCall);
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:axum:${httpMethod}:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName,
          line,
          framework: "axum_route",
          httpMethod,
          routePath,
        });
      }

      const actixRe = new RegExp(ACTIX_ROUTE_RE.source, ACTIX_ROUTE_RE.flags);
      for (const match of symbol.fullSource.matchAll(actixRe)) {
        const routePath = match[1] ?? "";
        const httpMethodMatch = (match[0] ?? "").match(/#\[(\w+)/);
        const httpMethod = (httpMethodMatch?.[1] ?? "get").toUpperCase();
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:actix:${httpMethod}:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: symbol.name,
          line,
          framework: "axum_route",
          httpMethod,
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "axum_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
