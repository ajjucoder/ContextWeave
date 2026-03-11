import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

const GIN_ROUTE_RE = /(?:r|e|router|group)\s*\.\s*(GET|POST|PUT|PATCH|DELETE|Any|Handle)\s*\(\s*"([^"]+)"\s*,\s*([A-Za-z_][\w.]*)/g;

function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}

export const ginFrameworkPlugin: FrameworkTracePlugin = {
  id: "gin",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "go") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const re = new RegExp(GIN_ROUTE_RE.source, GIN_ROUTE_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const httpMethod = (match[1] ?? "GET").toUpperCase();
        const routePath = match[2] ?? "";
        const handlerRef = match[3] ?? "";
        const targetName = handlerRef.split(".").pop() ?? handlerRef;
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:gin:${httpMethod}:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName,
          line,
          framework: "gin_route",
          httpMethod,
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "gin_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
