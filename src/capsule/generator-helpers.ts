import { dirname, sep } from "node:path";
import type { FileRecord, LightSymbolRecord } from "../core/types.js";

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))
  );
  return sorted[index] ?? 0;
}

export function getCommonDisplayRoot(paths: string[]): string | null {
  if (paths.length === 0) return null;
  let prefix = dirname(paths[0]!);

  for (const path of paths.slice(1)) {
    while (prefix && path !== prefix && !path.startsWith(`${prefix}${sep}`)) {
      const next = dirname(prefix);
      if (next === prefix) {
        prefix = "";
        break;
      }
      prefix = next;
    }
    if (!prefix) return null;
  }

  return prefix || null;
}

export function toDisplayPath(filePath: string, root: string | null): string {
  if (!root) return filePath.replaceAll("\\", "/");
  if (filePath === root) return filePath.replaceAll("\\", "/");
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!filePath.startsWith(rootWithSep)) return filePath.replaceAll("\\", "/");
  return filePath.slice(rootWithSep.length).replaceAll("\\", "/");
}

export function getLexicalScore(
  symbol: LightSymbolRecord,
  file: FileRecord,
  queryTerms: string[],
  exactQueryTerms: Set<string>
): number {
  const symbolName = symbol.name.toLowerCase();
  const signature = symbol.signature.toLowerCase();
  const filePath = file.path.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    if (!term) continue;
    const termWeight = exactQueryTerms.has(term) ? 1 : 0.5;
    if (symbolName.includes(term)) {
      score += 2 * termWeight;
      continue;
    }
    if (signature.includes(term)) {
      score += 1.5 * termWeight;
      continue;
    }
    if (filePath.includes(term)) {
      score += 1 * termWeight;
    }
  }
  return score;
}

export function isTestFile(path: string): boolean {
  const lower = path.toLowerCase().replaceAll("\\", "/");
  return (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.startsWith("test/") ||
    lower.startsWith("tests/") ||
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.includes("/__tests__/") ||
    lower.endsWith("_test.ts") ||
    lower.endsWith("_spec.ts")
  );
}

export function isTestQuery(queryTerms: string[]): boolean {
  const TEST_QUERY_TERMS = new Set([
    "test",
    "tests",
    "spec",
    "specs",
    "fixture",
    "fixtures",
    "mock",
    "mocks",
    "assert",
    "assertion",
    "jest",
    "vitest",
  ]);
  return queryTerms.some((term) => TEST_QUERY_TERMS.has(term));
}

export function isRenderOnlyFile(symbols: ReadonlyArray<Pick<LightSymbolRecord, "kind">>): boolean {
  if (symbols.length === 0) return false;
  const SUBSTANTIVE_KINDS = new Set(["function", "class", "method"]);
  return !symbols.some((s) => SUBSTANTIVE_KINDS.has(s.kind));
}
