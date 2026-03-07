import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { getRegisterTool } from "./register-helper.js";
import { isPathWithinRoot } from "../../core/indexer.js";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import type { SymbolRecord } from "../../core/types.js";
import { fuzzyMatch } from "../../utils/fuzzy.js";

const MAX_READ_BYTES = 2 * 1024 * 1024;

interface ResolvedSymbol {
  symbol: SymbolRecord;
  filePath: string;
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

function resolveSymbolTarget(
  db: Database.Database,
  projectRoot: string,
  symbolName: string,
  filePathFilter?: string
): ResolvedSymbol | null {
  const symbols = symbolQueries(db);
  const files = fileQueries(db);
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

  const filtered = filePathFilter
    ? candidates.filter((candidate) => resolve(candidate.filePath) === resolve(filePathFilter))
    : candidates;
  if (filtered.length === 0) return null;

  filtered.sort((a, b) => {
    if (b.symbol.centrality !== a.symbol.centrality) {
      return b.symbol.centrality - a.symbol.centrality;
    }
    if (a.symbol.startLine !== b.symbol.startLine) {
      return a.symbol.startLine - b.symbol.startLine;
    }
    return a.filePath.localeCompare(b.filePath);
  });

  return filtered[0]!;
}

export function parseSymbolTarget(
  input: string
): { fileSuffix: string; symbolName: string } | null {
  const lastColon = input.lastIndexOf(":");
  if (lastColon < 1) return null;
  const filePart = input.slice(0, lastColon);
  if (!filePart.includes(".")) return null;
  return { fileSuffix: filePart, symbolName: input.slice(lastColon + 1) };
}

export function registerReadTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    path: z.string().optional().describe("File path to read (absolute or relative to project root)"),
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
      path,
      symbol,
      start_line,
      end_line,
      max_lines,
    }: {
      path?: string;
      symbol?: string;
      start_line?: number;
      end_line?: number;
      max_lines?: number;
    }) => {
      try {
        if (!path && !symbol) {
          return {
            content: [{ type: "text" as const, text: "Error: provide path or symbol" }],
            isError: true,
          };
        }

        const resolvedRoot = resolve(projectRoot);
        const maxLines = max_lines ?? 200;

        const requestedPath = path ? resolve(resolvedRoot, path) : undefined;
        if (requestedPath && !isSafeProjectPath(requestedPath, resolvedRoot)) {
          return {
            content: [{ type: "text" as const, text: `Error: path "${path}" is outside the project root` }],
            isError: true,
          };
        }

        let resolvedSymbol: ResolvedSymbol | null = null;
        if (symbol) {
          const parsed = parseSymbolTarget(symbol);
          if (parsed) {
            const file = fileQueries(db).getByPathSuffix(parsed.fileSuffix);
            if (file) {
              const sym = symbolQueries(db).getByFileAndName(file.id, parsed.symbolName);
              if (sym) {
                resolvedSymbol = { symbol: sym, filePath: resolve(resolvedRoot, file.path) };
              }
            }
          }
          if (!resolvedSymbol) {
            resolvedSymbol = resolveSymbolTarget(db, resolvedRoot, symbol, requestedPath);
          }
        }
        if (symbol && !resolvedSymbol) {
          const detail = requestedPath ? ` in ${path}` : "";
          return {
            content: [{
              type: "text" as const,
              text: [
                `No indexed symbol found matching "${symbol}"${detail}`,
                `Next: cw_grep(query: "${symbol}") for exact symbol/text matches.`,
                `Next: cw_overview(query: "${symbol}") to inspect likely directories.`,
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
        const width = String(end).length;
        const displayPath = relative(resolvedRoot, targetPath).replace(/\\/g, "/") || targetPath;

        const lines = [`Read ${displayPath}:${start}-${end} (${excerpt.length} line${excerpt.length === 1 ? "" : "s"})`];
        if (resolvedSymbol) {
          lines.push(`Symbol: ${resolvedSymbol.symbol.kind} ${resolvedSymbol.symbol.name} (${resolvedSymbol.symbol.startLine}-${resolvedSymbol.symbol.endLine})`);
        }
        if (truncatedByMaxLines) {
          lines.push(`Truncated to max_lines=${maxLines}`);
        }
        lines.push("");

        for (let i = 0; i < excerpt.length; i++) {
          const lineNo = start + i;
          lines.push(`${String(lineNo).padStart(width, " ")} | ${excerpt[i] ?? ""}`);
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
