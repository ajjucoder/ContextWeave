import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";
import { lineNumberForOffset } from "../utils.js";

const ASPNET_ATTR_RE = /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|Route)\s*(?:\(\s*["']([^"']+)["'])?\s*\]/g;

const METHOD_MAP: Record<string, string> = {
  HttpGet: "GET",
  HttpPost: "POST",
  HttpPut: "PUT",
  HttpDelete: "DELETE",
  HttpPatch: "PATCH",
  Route: "ANY",
};

export const aspnetFrameworkPlugin: FrameworkTracePlugin = {
  id: "aspnet",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "c_sharp" && language !== "csharp") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const re = new RegExp(ASPNET_ATTR_RE.source, ASPNET_ATTR_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const attribute = match[1] ?? "Route";
        const routePath = match[2] ?? "/";
        const httpMethod = METHOD_MAP[attribute] ?? "ANY";
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:aspnet:${httpMethod}:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: symbol.name,
          line,
          framework: "aspnet_route",
          httpMethod,
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "aspnet_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
