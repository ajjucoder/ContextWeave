import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";
import { lineNumberForOffset } from "../utils.js";

const LARAVEL_ROUTE_RE = /Route\s*::\s*(get|post|put|patch|delete|any|match)\s*\(\s*["']([^"']+)["']\s*,\s*(?:\[([A-Za-z\\]+)\s*,\s*["']([A-Za-z_][\w]*)["']\]|["']([A-Za-z\\@]+)["'])/g;

export const laravelFrameworkPlugin: FrameworkTracePlugin = {
  id: "laravel",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "php") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const re = new RegExp(LARAVEL_ROUTE_RE.source, LARAVEL_ROUTE_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const httpMethod = (match[1] ?? "get").toUpperCase();
        const routePath = match[2] ?? "";
        const controllerMethod = match[4] ?? (match[5] ?? "").split("@").pop() ?? "";
        const controllerClass = match[3] ?? (match[5] ?? "").split("@")[0] ?? "";
        const targetName = controllerMethod || controllerClass;
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:laravel:${httpMethod}:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName,
          line,
          framework: "laravel_route",
          httpMethod,
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "laravel_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
