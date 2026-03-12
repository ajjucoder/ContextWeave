import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";
import { lineNumberForOffset } from "../utils.js";

const FASTAPI_ROUTE_RE = /@(?:app|router)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/g;

export const fastapiFrameworkPlugin: FrameworkTracePlugin = {
  id: "fastapi",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "python") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const re = new RegExp(FASTAPI_ROUTE_RE.source, FASTAPI_ROUTE_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const httpMethod = (match[1] ?? "get").toUpperCase();
        const routePath = match[2] ?? "";
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:fastapi:${httpMethod}:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: symbol.name,
          line,
          framework: "fastapi_route",
          httpMethod,
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "fastapi_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
