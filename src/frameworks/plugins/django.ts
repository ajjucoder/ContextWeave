import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";
import { lineNumberForOffset } from "../utils.js";

const URLPATTERNS_RE = /path\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_][\w.]*)/g;
const INCLUDE_RE = /include\s*\(\s*["']([^"']+)["']/g;

export const djangoFrameworkPlugin: FrameworkTracePlugin = {
  id: "django",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (language !== "python") return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const re = new RegExp(URLPATTERNS_RE.source, URLPATTERNS_RE.flags);
      for (const match of symbol.fullSource.matchAll(re)) {
        const routePath = match[1] ?? "";
        const viewRef = match[2] ?? "";
        const targetName = viewRef.split(".").pop() ?? viewRef;
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:django:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName,
          line,
          framework: "django_url",
          routePath,
        });
      }

      const incRe = new RegExp(INCLUDE_RE.source, INCLUDE_RE.flags);
      for (const match of symbol.fullSource.matchAll(incRe)) {
        const routePath = match[1] ?? "";
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:django:include:${routePath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: routePath,
          line,
          framework: "django_url",
          routePath,
        });
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "django_url";
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName).map((t) => t.id);
  },
};
