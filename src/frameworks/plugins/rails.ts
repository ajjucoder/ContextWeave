import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

const RAILS_ROUTE_RE = /(?:get|post|put|patch|delete|resources?|namespace)\s+["']([^"']+)["']\s*(?:,\s*to:\s*["']([^"']+)["'])?/g;

function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}

function extractControllerAction(toStr: string): { controller: string; action: string } | null {
  const parts = toStr.split("#");
  if (parts.length !== 2) return null;
  return { controller: parts[0]!.trim(), action: parts[1]!.trim() };
}

export const railsFrameworkPlugin: FrameworkTracePlugin = {
  id: "rails",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "ruby") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const re = new RegExp(RAILS_ROUTE_RE.source, RAILS_ROUTE_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const routePath = match[1] ?? "";
        const toStr = match[2] ?? "";
        const parsed = toStr ? extractControllerAction(toStr) : null;
        const targetName = parsed ? `${parsed.controller}#${parsed.action}` : routePath;
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:rails:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: parsed?.action ?? targetName,
          line,
          framework: "rails_route",
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "rails_route";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
