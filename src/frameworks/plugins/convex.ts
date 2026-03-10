import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

type ConvexFramework = "convex_mutation" | "convex_query" | "convex_action";

function isJsLikeLanguage(language: string): boolean {
  return ["typescript", "tsx", "javascript", "jsx"].includes(language);
}

function lineNumberForOffset(source: string, startLine: number, offset: number): number {
  return startLine + source.slice(0, offset).split("\n").length - 1;
}

const CONVEX_CALLER_PATTERNS: Array<{
  re: RegExp;
  framework: ConvexFramework;
}> = [
  { re: /\buseMutation\s*\(\s*api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g, framework: "convex_mutation" },
  { re: /\buseQuery\s*\(\s*api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g, framework: "convex_query" },
  { re: /\buseAction\s*\(\s*api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g, framework: "convex_action" },
];

export const convexFrameworkPlugin: FrameworkTracePlugin = {
  id: "convex",

  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (!isJsLikeLanguage(language)) return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      for (const { re, framework } of CONVEX_CALLER_PATTERNS) {
        const pattern = new RegExp(re.source, re.flags);
        for (const match of symbol.fullSource.matchAll(pattern)) {
          const module = match[1];
          const exportName = match[2];
          if (!module || !exportName) continue;

          const line = lineNumberForOffset(symbol.fullSource, symbol.startLine, match.index ?? 0);
          const key = `${symbol.name}:${framework}:${module}.${exportName}:${line}`;
          if (seen.has(key)) continue;
          seen.add(key);

          calls.push({
            callerSymbol: symbol.name,
            targetName: exportName,
            line,
            framework,
            convexModule: module,
            convexExport: exportName,
          });
        }
      }
    }

    return calls;
  },

  supports(call: ParsedFrameworkCall): boolean {
    return (
      call.framework === "convex_mutation" ||
      call.framework === "convex_query" ||
      call.framework === "convex_action"
    );
  },

  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    const module = call.convexModule;
    const exportName = call.convexExport;
    if (!module || !exportName) return [];

    const targetIds = new Set<number>();

    const convexFiles = [
      ...context.files.searchByPath(`convex/${module}`, 50),
      ...context.files.searchByPath(`convex/${module}.ts`, 50),
      ...context.files.searchByPath(`convex/${module}.js`, 50),
    ].filter((file, index, all) =>
      all.findIndex((other) => other.id === file.id) === index
    );

    for (const file of convexFiles) {
      const handler = context.symbols.getByFileAndName(file.id, exportName);
      if (handler) {
        targetIds.add(handler.id);
        continue;
      }

      const allSymbols = context.symbols.getByFileId(file.id);
      const exportMatch = allSymbols.find(
        (sym) =>
          sym.name === exportName &&
          sym.isExported
      );
      if (exportMatch) {
        targetIds.add(exportMatch.id);
      }
    }

    if (targetIds.size === 0) {
      const fallback = context.pickTargets(exportName);
      for (const t of fallback) targetIds.add(t.id);
    }

    return [...targetIds];
  },
};
