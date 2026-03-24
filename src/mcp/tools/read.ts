import { readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { getRegisterTool } from "./register-helper.js";
import { isSafeProjectPath } from "./path-filters.js";
import { fileQueries } from "../../db/queries/files.js";
import { sessionQueries } from "../../db/queries/sessions.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import type { SymbolRecord } from "../../core/types.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";

const MAX_READ_BYTES = 2 * 1024 * 1024;
export const DEFAULT_READ_CHAR_BUDGET = 20_000;
const sessionReadChars = new Map<string, number>();

interface ResolvedSymbol {
  symbol: SymbolRecord;
  filePath: string;
}

interface BudgetedExcerpt {
  lines: string[];
  charsUsed: number;
  truncated: boolean;
}

export function getSessionReadChars(sessionId: string): number {
  return sessionReadChars.get(sessionId) ?? 0;
}

export function applyCharBudget(
  excerpt: string[],
  remainingChars: number
): BudgetedExcerpt {
  const fullText = excerpt.join("\n");
  if (remainingChars >= fullText.length) {
    return {
      lines: excerpt,
      charsUsed: fullText.length,
      truncated: false,
    };
  }

  if (remainingChars <= 0) {
    return {
      lines: [],
      charsUsed: 0,
      truncated: excerpt.length > 0,
    };
  }

  const lines: string[] = [];
  let charsUsed = 0;

  for (const line of excerpt) {
    const newlineCost = lines.length > 0 ? 1 : 0;
    const fullLineCost = newlineCost + line.length;
    if (fullLineCost <= remainingChars - charsUsed) {
      if (newlineCost > 0) {
        charsUsed += newlineCost;
      }
      lines.push(line);
      charsUsed += line.length;
      continue;
    }

    const remainingForLine = remainingChars - charsUsed - newlineCost;
    if (remainingForLine > 0) {
      if (newlineCost > 0) {
        charsUsed += newlineCost;
      }
      lines.push(line.slice(0, remainingForLine));
      charsUsed += remainingForLine;
    }
    break;
  }

  return {
    lines,
    charsUsed,
    truncated: true,
  };
}

function resolveSymbolTarget(
  db: Database.Database,
  projectRoot: string,
  symbolName: string,
  filePathFilter?: string
): ResolvedSymbol | null {
  const symbols = symbolQueries(db);
  const files = fileQueries(db);

  if (filePathFilter) {
    const resolvedFilter = resolve(filePathFilter);
    const allFiles = files.getAll();
    const matchedFile = allFiles.find((f) => resolve(projectRoot, f.path) === resolvedFilter)
      ?? allFiles.find((f) => resolvedFilter.endsWith(f.path));
    if (matchedFile) {
      const fileSymbols = symbols.getByFileId(matchedFile.id);
      const exactMatch = fileSymbols.find((s) => s.name.toLowerCase() === symbolName.toLowerCase());
      if (exactMatch) {
        return { symbol: exactMatch, filePath: resolve(projectRoot, matchedFile.path) };
      }
      const fuzzyMatches = fuzzyMatch(symbolName, fileSymbols.map((s) => s.name), 0.6);
      if (fuzzyMatches.length > 0) {
        const matched = fileSymbols.find((s) => s.name === fuzzyMatches[0]!.name);
        if (matched) {
          return { symbol: matched, filePath: resolve(projectRoot, matchedFile.path) };
        }
      }
      return null;
    }
    return null;
  }

  const allNames = symbols.getAllNames();
  const matches = fuzzyMatch(symbolName, allNames, 0.6);
  if (matches.length === 0) return null;

  const bestName = matches[0]!.name;
  const candidates = symbols.getByName(bestName)
    .map((symbol) => {
      const file = files.getById(symbol.fileId);
      if (!file) return null;
      return { symbol, filePath: resolve(projectRoot, file.path) };
    })
    .filter((candidate): candidate is ResolvedSymbol => candidate !== null);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.symbol.centrality !== a.symbol.centrality) {
      return b.symbol.centrality - a.symbol.centrality;
    }
    if (a.symbol.startLine !== b.symbol.startLine) {
      return a.symbol.startLine - b.symbol.startLine;
    }
    return a.filePath.localeCompare(b.filePath);
  });

  return candidates[0]!;
}

export function resolveFilePath(
  inputPath: string,
  projectRoot: string,
  db: Database.Database
): string | null {
  const files = fileQueries(db);
  const candidates = [
    inputPath,
    resolve(projectRoot, inputPath),
    resolve(projectRoot, "src", inputPath),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.replace(/\\/g, "/");
    const file = files.getByPath(normalized);
    if (file) return resolve(projectRoot, normalized);
    try {
      statSync(candidate);
      return candidate;
    } catch {
    }
  }

  const suffix = inputPath.replace(/\\/g, "/");
  const match = files.getByPathSuffix(suffix);
  if (match) return resolve(projectRoot, match.path);

  return null;
}

export function parseSymbolTarget(
  input: string
): { fileSuffix: string; symbolName: string } | null {
  const doubleColon = input.lastIndexOf("::");
  if (doubleColon > 0) {
    const filePart = input.slice(0, doubleColon);
    const symbolName = input.slice(doubleColon + 2);
    if (filePart.includes(".") && symbolName.length > 0) {
      return { fileSuffix: filePart, symbolName };
    }
  }

  const lastColon = input.lastIndexOf(":");
  if (lastColon < 1) return null;
  const filePart = input.slice(0, lastColon);
  const symbolName = input.slice(lastColon + 1);
  if (!filePart.includes(".") || symbolName.length === 0) return null;
  return { fileSuffix: filePart, symbolName };
}

export function registerReadTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  sessionId?: string,
  charBudget = DEFAULT_READ_CHAR_BUDGET
): void {
  const registerTool = getRegisterTool(server);
  const readSessionId = sessionId ?? `cw-read-${randomUUID()}`;
  const inputSchema: Record<string, z.ZodTypeAny> = {
    path: z.string().optional().describe("File path to read (absolute or relative to project root)"),
    file: z.string().optional().describe("Alias for path (accepted for compatibility)"),
    symbol: z.string().optional().describe("Optional indexed symbol name to resolve file/range"),
    start_line: z.number().int().min(1).optional().describe("1-based starting line"),
    end_line: z.number().int().min(1).optional().describe("1-based ending line"),
    max_lines: z.number().int().min(1).max(500).optional().describe("Hard cap on returned lines (default: 200)"),
  };

  registerTool(
    "cw_read",
    "Read a safe, bounded range from a project file. Supports optional indexed symbol lookup.",
    inputSchema,
    async ({
      path: pathArg,
      file: fileArg,
      symbol,
      start_line,
      end_line,
      max_lines,
    }: {
      path?: string;
      file?: string;
      symbol?: string;
      start_line?: number;
      end_line?: number;
      max_lines?: number;
    }) => {
      try {
        const rawPath = pathArg ?? fileArg;
        if (!rawPath && !symbol) {
          return {
            content: [{ type: "text" as const, text: "Error: provide path or symbol" }],
            isError: true,
          };
        }

        const resolvedRoot = resolve(projectRoot);
        const maxLines = max_lines ?? 200;
        sessionQueries(db).ensureSession(readSessionId, resolvedRoot);

        const inferredSymbolTarget = symbol ? null : (rawPath ? parseSymbolTarget(rawPath) : null);
        const path = inferredSymbolTarget ? inferredSymbolTarget.fileSuffix : rawPath;
        const requestedSymbol = symbol ?? (inferredSymbolTarget ? rawPath : undefined);
        let requestedPath: string | undefined;
        if (path) {
          const direct = resolve(resolvedRoot, path);
          let exists = false;
          try { statSync(direct); exists = true; } catch { }
          requestedPath = exists ? direct : (resolveFilePath(path, resolvedRoot, db) ?? direct);
        }
        if (requestedPath && !isSafeProjectPath(requestedPath, resolvedRoot)) {
          return {
            content: [{ type: "text" as const, text: `Error: path "${path}" is outside the project root` }],
            isError: true,
          };
        }

        let resolvedSymbol: ResolvedSymbol | null = null;
        let disambiguationNote: string | null = null;
        if (requestedSymbol) {
          const parsed = parseSymbolTarget(requestedSymbol);
          if (parsed) {
            const filesApi = fileQueries(db);
            const allMatches = filesApi.getAllByPathSuffix(parsed.fileSuffix);
            if (allMatches.length > 0) {
              const srcFirst = [...allMatches].sort((a, b) => {
                const aIsSrc = a.path.startsWith("src/") ? 0 : 1;
                const bIsSrc = b.path.startsWith("src/") ? 0 : 1;
                return aIsSrc - bIsSrc || a.path.length - b.path.length;
              });
              const file = srcFirst[0]!;
              const sym = symbolQueries(db).getByFileAndName(file.id, parsed.symbolName);
              if (sym) {
                resolvedSymbol = { symbol: sym, filePath: resolve(resolvedRoot, file.path) };
                if (allMatches.length > 1) {
                  const others = srcFirst.slice(1).map((f) => f.path).join(", ");
                  disambiguationNote = `Note: multiple files match "${parsed.fileSuffix}". Using ${file.path}. Others: ${others}`;
                }
              }
            }
          }
          if (!resolvedSymbol) {
            resolvedSymbol = resolveSymbolTarget(db, resolvedRoot, requestedSymbol, requestedPath);
          }
        }
        if (requestedSymbol && !resolvedSymbol) {
          const detail = requestedPath ? ` in ${path}` : "";
          return {
            content: [{
              type: "text" as const,
              text: [
                `No indexed symbol found matching "${requestedSymbol}"${detail}`,
                `Next: cw_grep(query: "${requestedSymbol}") for exact symbol/text matches.`,
                `Next: cw_overview(query: "${requestedSymbol}") to inspect likely directories.`,
              ].join("\n"),
            }],
          };
        }

        const targetPath = resolvedSymbol?.filePath ?? requestedPath;
        if (!targetPath) {
          return {
            content: [{ type: "text" as const, text: "Error: unable to resolve target path" }],
            isError: true,
          };
        }

        if (!isSafeProjectPath(targetPath, resolvedRoot)) {
          return {
            content: [{ type: "text" as const, text: "Error: resolved path is outside the project root" }],
            isError: true,
          };
        }

        let fileStat;
        try {
          fileStat = statSync(targetPath);
        } catch {
          return {
            content: [{ type: "text" as const, text: `Error: file does not exist at "${targetPath}"` }],
            isError: true,
          };
        }

        if (!fileStat.isFile()) {
          return {
            content: [{ type: "text" as const, text: `Error: "${targetPath}" is not a file` }],
            isError: true,
          };
        }

        if (fileStat.size > MAX_READ_BYTES) {
          return {
            content: [{ type: "text" as const, text: `Error: file exceeds ${MAX_READ_BYTES} byte read limit` }],
            isError: true,
          };
        }

        const content = readFileSync(targetPath, "utf-8");
        const allLines = content.split(/\r?\n/);
        const totalLines = allLines.length;
        const symbolStart = resolvedSymbol?.symbol.startLine;
        const symbolEnd = resolvedSymbol?.symbol.endLine;

        let start = start_line ?? symbolStart ?? 1;
        let end = end_line ?? symbolEnd ?? Math.min(totalLines, start + maxLines - 1);

        if (start > totalLines) {
          start = totalLines;
        }
        if (end > totalLines) {
          end = totalLines;
        }
        if (end < start) {
          return {
            content: [{ type: "text" as const, text: `Error: end_line (${end}) must be >= start_line (${start})` }],
            isError: true,
          };
        }

        let truncatedByMaxLines = false;
        const requestedCount = end - start + 1;
        if (requestedCount > maxLines) {
          end = start + maxLines - 1;
          truncatedByMaxLines = true;
        }

        const excerpt = allLines.slice(start - 1, end);
        const rawExcerptChars = excerpt.join("\n").length;
        const remainingChars = Math.max(0, charBudget - getSessionReadChars(readSessionId));
        const budgetedExcerpt = applyCharBudget(excerpt, remainingChars);
        const budgetTruncated = budgetedExcerpt.truncated;
        sessionReadChars.set(readSessionId, getSessionReadChars(readSessionId) + budgetedExcerpt.charsUsed);
        const displayedEnd = budgetedExcerpt.lines.length > 0 ? start + budgetedExcerpt.lines.length - 1 : start;
        const width = String(end).length;
        const displayPath = relative(resolvedRoot, targetPath).replace(/\\/g, "/") || targetPath;

        const lines = [
          `Read ${displayPath}:${start}-${displayedEnd} (${budgetedExcerpt.lines.length} line${budgetedExcerpt.lines.length === 1 ? "" : "s"})`,
        ];
        if (resolvedSymbol) {
          lines.push(`Symbol: ${resolvedSymbol.symbol.kind} ${resolvedSymbol.symbol.name} (${resolvedSymbol.symbol.startLine}-${resolvedSymbol.symbol.endLine})`);
        }
        if (disambiguationNote) {
          lines.push(disambiguationNote);
        }
        if (truncatedByMaxLines) {
          lines.push(`Truncated to max_lines=${maxLines}`);
        }
        if (budgetTruncated) {
          lines.push(
            `Warning: Budget exceeded for this session; returned ${budgetedExcerpt.charsUsed} of ${rawExcerptChars} requested chars (${getSessionReadChars(readSessionId)}/${charBudget} chars used).`
          );
        }
        lines.push("");

        for (let i = 0; i < budgetedExcerpt.lines.length; i++) {
          const lineNo = start + i;
          lines.push(`${String(lineNo).padStart(width, " ")} | ${budgetedExcerpt.lines[i] ?? ""}`);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Read failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
