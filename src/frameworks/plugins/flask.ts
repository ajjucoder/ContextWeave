import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";
import { lineNumberForOffset } from "../utils.js";

const FLASK_ROUTE_RE = /@(?:app|bp|blueprint)\s*\.\s*route\s*\(\s*["']([^"']+)["'][^)]*\)/g;
const FLASK_METHOD_RE = /methods\s*=\s*\[([^\]]+)\]/;

export const flaskFrameworkPlugin: FrameworkTracePlugin = {
  id: "flask",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "python") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      for (const decorator of symbol.decorators ?? []) {
        if (decorator.name !== "route") continue;
        const routePath = decorator.args?.[0]?.replace(/^["']|["']$/g, "") ?? "/";
        const methodsMatch = decorator.fullText.match(FLASK_METHOD_RE);
        const httpMethod = methodsMatch
          ? methodsMatch[1]!.split(",")[0]!.trim().replace(/['"\s]/g, "").toUpperCase()
          : "GET";
        const key = `${symbol.name}:flask:${routePath}:${symbol.startLine}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: symbol.name,
          line: symbol.startLine,
          framework: "flask_route",
          httpMethod,
          routePath,
        });
      }

      const re = new RegExp(FLASK_ROUTE_RE.source, FLASK_ROUTE_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const routePath = match[1] ?? "";
        const methodsMatch = (match[0] ?? "").match(FLASK_METHOD_RE);
        const httpMethod = methodsMatch
          ? methodsMatch[1]!.split(",")[0]!.trim().replace(/['"\s]/g, "").toUpperCase()
          : "GET";
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:flask:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: symbol.name,
          line,
          framework: "flask_route",
          httpMethod,
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "flask_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
