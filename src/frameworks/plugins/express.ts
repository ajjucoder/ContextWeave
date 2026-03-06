import type { ParsedFrameworkCall, ParsedSymbol } from "../../core/types.js";
import type { FrameworkResolveContext, FrameworkTracePlugin } from "../types.js";

function isJsLikeLanguage(language: string): boolean {
  return ["typescript", "tsx", "javascript", "jsx"].includes(language);
}

export const expressFrameworkPlugin: FrameworkTracePlugin = {
  id: "express",
  extractCalls(language: string, symbols: ParsedSymbol[]): ParsedFrameworkCall[] {
    if (!isJsLikeLanguage(language)) return [];

    const calls: ParsedFrameworkCall[] = [];
    const seen = new Set<string>();

    for (const symbol of symbols) {
      const lines = symbol.fullSource.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const lineText = lines[index] ?? "";
        const expressMatch = lineText.match(
          /\.\s*(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\)/
        );
        if (!expressMatch) continue;
        const handlerRef = expressMatch[3] ?? "";
        const targetName = handlerRef.split(".").filter(Boolean).pop();
        if (!targetName) continue;
        const key = `${symbol.name}:express:${targetName}:${index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        calls.push({
          callerSymbol: symbol.name,
          targetName,
          line: symbol.startLine + index,
          framework: "express_route",
          httpMethod: expressMatch[1]?.toUpperCase(),
          routePath: expressMatch[2],
        });
      }
    }

    return calls;
  },
  supports(call: ParsedFrameworkCall): boolean {
    return call.framework === "express_route";
  },
  resolveTargets(call: ParsedFrameworkCall, context: FrameworkResolveContext): number[] {
    return context.pickTargets(call.targetName, call.targetName).map((target) => target.id);
  },
};
