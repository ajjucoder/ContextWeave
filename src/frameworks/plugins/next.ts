import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import { matchesNextApiRouteFile } from "../../utils/path-retrieval.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

function isJsLikeLanguage(language: string): boolean {
  return ["typescript", "tsx", "javascript", "jsx"].includes(language);
}

function stripJsWrapper(raw: string): string {
  const text = raw.trim();
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith(`"`) && text.endsWith(`"`)) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}

export const nextFrameworkPlugin: FrameworkTracePlugin = {
  id: "next",
  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (!isJsLikeLanguage(language)) return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const fetchRe = /fetch\s*\(\s*(`[\s\S]*?`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")([\s\S]*?)\)/g;
      for (const match of symbol.fullSource.matchAll(fetchRe)) {
        const rawPath = stripJsWrapper(match[1] ?? "");
        if (!rawPath.startsWith("/api/")) continue;
        const methodMatch = (match[2] ?? "").match(/method\s*:\s*['"`]([A-Z]+)['"`]/i);
        const httpMethod = (methodMatch?.[1] ?? "GET").toUpperCase();
        const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
        const key = `${symbol.name}:next:${httpMethod}:${rawPath}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName: httpMethod,
          line,
          framework: "next_fetch",
          httpMethod,
          routePath: rawPath,
        });
      }
    }

    return calls;
  },
  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "next_fetch";
  },
  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    const routePath = call.routePath;
    if (!routePath) return [];

    const targetIds = new Set<number>();
    const routeFiles = [
      ...context.files.searchByPath("app/api", 500),
      ...context.files.searchByPath("pages/api", 500),
    ].filter((candidate, index, all) =>
      all.findIndex((other) => other.id === candidate.id) === index && matchesNextApiRouteFile(candidate.path, routePath)
    );

    for (const routeFile of routeFiles) {
      const handler = context.symbols.getByFileAndName(routeFile.id, call.targetName);
      if (handler) {
        targetIds.add(handler.id);
        continue;
      }

      if (!routeFile.path.replace(/\\/g, "/").includes("/pages/api/")) continue;
      const exportedHandlers = context.symbols
        .getByFileId(routeFile.id)
        .filter((symbol) => symbol.isExported && (symbol.kind === "function" || symbol.kind === "arrow"));

      for (const exportedHandler of exportedHandlers) {
        targetIds.add(exportedHandler.id);
      }
    }

    return [...targetIds];
  },
};
