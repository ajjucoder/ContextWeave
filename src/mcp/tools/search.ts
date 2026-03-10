import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { isPathWithinRoot } from "../../core/indexer.js";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { globToRegExp, toProjectRelativePath, withinPath } from "./path-filters.js";
import { runRipgrepSearch, isRipgrepAvailable } from "./ripgrep.js";
import { getRegisterTool } from "./register-helper.js";

interface MatchSpan {
  start: number;
  end: number;
}

interface SearchResult {
  path: string;
  line: number;
  snippet: string;
}

function isSafeProjectPath(filePath: string, projectRoot: string): boolean {
  if (!isPathWithinRoot(filePath, projectRoot)) return false;

  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      const realPath = realpathSync(filePath);
      return isPathWithinRoot(realPath, projectRoot);
    }
  } catch {
    return false;
  }

  return true;
}

export function parseDelimitedRegex(query: string): { pattern: string; flags: string } | null {
  if (!query.startsWith("/") || query.length < 2) return null;
  const lastSlash = query.lastIndexOf("/");
  if (lastSlash <= 0) return null;

  const pattern = query.slice(1, lastSlash);
  const flags = query.slice(lastSlash + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) return null;

  return { pattern, flags };
}

export function detectBraceExpansion(pattern: string): void {
  const braceMatch = /\{[^{}]*,[^{}]*\}/.exec(pattern);
  if (braceMatch) {
    const inner = braceMatch[0].slice(1, -1);
    const alternatives = inner.split(",").map(s => s.trim()).join("|");
    throw new Error(
      `Brace expansion "${braceMatch[0]}" is not supported in search patterns. ` +
      `Use regex alternation instead: (${alternatives})`
    );
  }
}

function withCaseFlag(flags: string, caseSensitive: boolean): string {
  const cleaned = flags.replace(/i/g, "");
  return caseSensitive ? cleaned : `${cleaned}i`;
}

export function buildRegex(query: string, useRegex: boolean, caseSensitive: boolean): RegExp | null {
  const delimited = parseDelimitedRegex(query);
  if (!useRegex && !delimited) return null;

  const source = delimited ? delimited.pattern : query;
  let flags = delimited ? delimited.flags : "";
  flags = withCaseFlag(flags, caseSensitive);
  if (!flags.includes("g")) flags += "g";

  return new RegExp(source, flags);
}

function findLiteralMatches(content: string, query: string, caseSensitive: boolean, maxMatches: number): MatchSpan[] {
  if (maxMatches <= 0) return [];

  const spans: MatchSpan[] = [];
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return spans;

  let from = 0;
  while (spans.length < maxMatches) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    spans.push({ start: at, end: at + needle.length });
    from = at + Math.max(needle.length, 1);
  }
  return spans;
}

function findRegexMatches(content: string, regex: RegExp, maxMatches: number): MatchSpan[] {
  if (maxMatches <= 0) return [];

  const spans: MatchSpan[] = [];
  regex.lastIndex = 0;

  while (spans.length < maxMatches) {
    const match = regex.exec(content);
    if (!match) break;

    const matchText = match[0] ?? "";
    const start = match.index;
    const end = start + Math.max(matchText.length, 1);
    spans.push({ start, end });

    if (matchText.length === 0) {
      regex.lastIndex += 1;
    }
  }

  return spans;
}

function buildLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineForOffset(offset: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid]!;
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1]! : Number.MAX_SAFE_INTEGER;

    if (offset < start) {
      high = mid - 1;
      continue;
    }

    if (offset >= next) {
      low = mid + 1;
      continue;
    }

    return mid + 1;
  }

  return lineStarts.length;
}

function renderSnippet(lines: string[], lineNumber: number, contextLines: number): string {
  const start = Math.max(1, lineNumber - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);
  const width = String(end).length;

  const out: string[] = [];
  for (let line = start; line <= end; line++) {
    const marker = line === lineNumber ? ">" : " ";
    out.push(`${marker} ${String(line).padStart(width, " ")} | ${lines[line - 1] ?? ""}`);
  }
  return out.join("\n");
}

export function registerSearchTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    query: z.string().min(1).max(500).describe("Text query or regex-style pattern to search for"),
    path: z.string().optional().describe("Optional directory scope inside project root"),
    glob: z.string().optional().describe("Optional glob-like filter, e.g. **/*.ts"),
    use_regex: z.boolean().optional().describe("Treat query as regex (or pass /pattern/flags)"),
    case_sensitive: z.boolean().optional().describe("Case-sensitive search (default: false)"),
    context_lines: z.number().int().min(0).max(8).optional().describe("Snippet lines of context around each hit (default: 1)"),
    max_results: z.number().int().min(1).max(200).optional().describe("Maximum number of matches to return (default: 20)"),
  };

  registerTool(
    "cw_grep",
    "Search project files by text or regex pattern with line-aware snippets and enclosing symbol context. Uses ripgrep when available for fast search.",
    inputSchema,
    async ({
      query,
      path,
      glob,
      use_regex,
      case_sensitive,
      context_lines,
      max_results,
    }: {
      query: string;
      path?: string;
      glob?: string;
      use_regex?: boolean;
      case_sensitive?: boolean;
      context_lines?: number;
      max_results?: number;
    }) => {
      try {
        const resolvedRoot = resolve(projectRoot);
        const parsedRegex = parseDelimitedRegex(query);
        const caseSensitive = case_sensitive ?? false;
        const effectiveCaseSensitive = parsedRegex?.flags.includes("i") ? false : caseSensitive;
        const autoRegex = parsedRegex !== null;
        const useRegexSearch = use_regex === true || autoRegex;
        const ripgrepQuery = parsedRegex ? parsedRegex.pattern : query;
        const parsedMultiline = parsedRegex?.flags.includes("m") ?? false;
        detectBraceExpansion(ripgrepQuery);
        const contextLines = context_lines ?? 1;
        const maxResults = max_results ?? 20;
        const scopePath = path?.trim();
        const globRegex = glob && glob.trim().length > 0 ? globToRegExp(glob.trim()) : null;

        const files = fileQueries(db);
        const symbols = symbolQueries(db);

        if (files.count() === 0) {
          return {
            content: [{ type: "text" as const, text: "No indexed files available. Run cw_reindex first." }],
          };
        }

        const useRipgrep = await isRipgrepAvailable();
        const results: SearchResult[] = [];

        if (useRipgrep) {
          const searchRoot = scopePath ? resolve(resolvedRoot, scopePath) : resolvedRoot;
          if (!isSafeProjectPath(searchRoot, resolvedRoot) && searchRoot !== resolvedRoot) {
            return {
              content: [{ type: "text" as const, text: `Error: path "${path}" is outside the project root` }],
              isError: true,
            };
          }
          const rgMatches = await runRipgrepSearch(ripgrepQuery, searchRoot, {
            caseSensitive: effectiveCaseSensitive,
            glob: glob?.trim() || undefined,
            maxResults: maxResults * 3,
            useRegex: useRegexSearch,
            multiline: parsedMultiline,
          });

          for (const match of rgMatches) {
            if (results.length >= maxResults) break;
            const absPath = resolve(searchRoot, match.path);
            if (!isSafeProjectPath(absPath, resolvedRoot)) continue;
            const relPath = toProjectRelativePath(resolvedRoot, absPath);
            if (globRegex && !globRegex.test(relPath)) continue;

            const file = files.getByPath(relPath);
            const enclosing = file ? symbols.getEnclosingSymbol(file.id, match.line) : null;
            const symbolContext = enclosing ? ` [in ${enclosing.kind} ${enclosing.name}]` : "";

            let content: string;
            try {
              content = readFileSync(absPath, "utf-8");
            } catch {
              continue;
            }
            const lines = content.split(/\r?\n/);
            results.push({
              path: relPath + symbolContext,
              line: match.line,
              snippet: renderSnippet(lines, match.line, contextLines),
            });
          }
        } else {
          // Fallback: in-process file scan
          const regex = buildRegex(query, useRegexSearch, effectiveCaseSensitive);

          for (const file of files.iterateAll()) {
            if (results.length >= maxResults) break;
            const fullPath = resolve(resolvedRoot, file.path);
            if (!isSafeProjectPath(fullPath, resolvedRoot)) continue;
            const relPath = toProjectRelativePath(resolvedRoot, fullPath);
            if (!withinPath(relPath, scopePath)) continue;
            if (globRegex && !globRegex.test(relPath)) continue;

            let content: string;
            try {
              content = readFileSync(fullPath, "utf-8");
            } catch {
              continue;
            }
            if (!content) continue;

            const lineStarts = buildLineStarts(content);
            const lines = content.split(/\r?\n/);
            const remaining = maxResults - results.length;
            const spans = regex
              ? findRegexMatches(content, regex, remaining)
              : findLiteralMatches(content, query, effectiveCaseSensitive, remaining);

            if (spans.length === 0) continue;

            for (const span of spans) {
              const lineNumber = lineForOffset(span.start, lineStarts);
              const enclosing = symbols.getEnclosingSymbol(file.id, lineNumber);
              const symbolContext = enclosing ? ` [in ${enclosing.kind} ${enclosing.name}]` : "";
              results.push({
                path: relPath + symbolContext,
                line: lineNumber,
                snippet: renderSnippet(lines, lineNumber, contextLines),
              });
              if (results.length >= maxResults) break;
            }
          }
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No matches found for "${query}"` }],
          };
        }

        const lines = [`Search results for "${query}" (${results.length} match${results.length === 1 ? "" : "es"}):`, ""];
        for (let i = 0; i < results.length; i++) {
          const result = results[i]!;
          lines.push(`${i + 1}. ${result.path}:${result.line}`);
          lines.push(result.snippet);
          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n").trimEnd() }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Search failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
