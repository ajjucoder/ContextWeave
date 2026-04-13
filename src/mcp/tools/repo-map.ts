import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { searchFilesByQuery } from "../../core/file-summaries.js";
import { getRegisterTool } from "./register-helper.js";
import { toProjectRelativePath, withinPath } from "./path-filters.js";

type MapFile = {
  id: number;
  path: string;
  symbolCount: number;
};

function approximateTokenTrim(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const lines = text.split("\n");
  const kept: string[] = [];
  let approxTokens = 0;

  for (const line of lines) {
    const lineTokens = Math.max(1, Math.ceil(line.length / 4));
    if (approxTokens + lineTokens > maxTokens) {
      kept.push("... output truncated by max_tokens");
      break;
    }
    kept.push(line);
    approxTokens += lineTokens;
  }

  return kept.join("\n");
}

function formatDirectories(files: MapFile[], limit: number): string[] {
  const counts = new Map<string, { files: number; symbols: number }>();

  for (const file of files) {
    const parts = file.path.split("/");
    const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    const existing = counts.get(directory) ?? { files: 0, symbols: 0 };
    existing.files += 1;
    existing.symbols += file.symbolCount;
    counts.set(directory, existing);
  }

  return [...counts.entries()]
    .map(([path, stat]) => ({
      path,
      files: stat.files,
      symbols: stat.symbols,
    }))
    .sort((a, b) => b.files - a.files || b.symbols - a.symbols || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => `- ${entry.path} (${entry.files} files, ${entry.symbols} symbols)`);
}

function compactKind(kind: string): string {
  switch (kind) {
    case "function":
    case "method":
      return "fn";
    case "class":
      return "class";
    case "interface":
      return "iface";
    case "type":
      return "type";
    case "constant":
    case "variable":
      return "var";
    default:
      return kind;
  }
}

export function registerRepoMapTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    path: z.string().optional().describe("Directory scope inside project (default: project root)"),
    query: z.string().max(2000).optional().describe("Optional query to focus the map on relevant files"),
    max_files: z.number().min(1).max(50).optional().describe("Max files to show (default: 12)"),
    max_symbols_per_file: z.number().min(1).max(8).optional().describe("Max symbols per file (default: 3)"),
    max_tokens: z.number().min(200).max(8000).optional().describe("Approx output token cap (default: 1600)"),
  };

  registerTool(
    "cw_repo_map",
    "Show a compact repo map from the existing index so agents can orient with fewer tokens and fewer file reads.",
    inputSchema,
    async ({
      path,
      query,
      max_files,
      max_symbols_per_file,
      max_tokens,
    }: {
      path?: string;
      query?: string;
      max_files?: number;
      max_symbols_per_file?: number;
      max_tokens?: number;
    }) => {
      try {
        const filesApi = fileQueries(db);
        const symbolsApi = symbolQueries(db);
        const basePath = path?.trim();
        const maxFiles = max_files ?? 8;
        const maxSymbolsPerFile = max_symbols_per_file ?? 2;
        const maxTokens = max_tokens ?? 1600;

        const scopedFiles = filesApi
          .getAll()
          .map((file) => ({
            id: file.id,
            path: toProjectRelativePath(projectRoot, file.path),
            symbolCount: file.symbolCount,
          }))
          .filter((file) => withinPath(file.path, basePath));

        const scopedFileIds = new Set(scopedFiles.map((file) => file.id));
        const queryTerm = query?.trim();
        const selectedFiles = queryTerm
          ? searchFilesByQuery(db, queryTerm, maxFiles, projectRoot)
            .filter((file) => scopedFileIds.has(file.fileId))
            .map((file) => {
              const match = scopedFiles.find((candidate) => candidate.id === file.fileId);
              return match ?? {
                id: file.fileId,
                path: toProjectRelativePath(projectRoot, file.path),
                symbolCount: filesApi.getById(file.fileId)?.symbolCount ?? 0,
              };
            })
          : [...scopedFiles]
            .sort((a, b) => b.symbolCount - a.symbolCount || a.path.localeCompare(b.path))
            .slice(0, maxFiles);

        const lines: string[] = [
          "ContextWeave Repo Map",
          `Scope: ${basePath ?? "."} | Indexed Files: ${scopedFiles.length} | Files Shown: ${selectedFiles.length}`,
        ];

        if (queryTerm) {
          lines.push(`Query Focus: "${queryTerm}"`);
        }

        if (scopedFiles.length === 0) {
          lines.push("", "No indexed files found for this scope.");
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        const directoryLines = formatDirectories(scopedFiles, 6);
        if (directoryLines.length > 0) {
          lines.push("", "Directories:");
          lines.push(...directoryLines);
        }

        lines.push("", queryTerm ? "Focused Files:" : "Top Files:");
        if (selectedFiles.length === 0) {
          lines.push(queryTerm ? "No files matched this query." : "No files selected.");
        } else {
          for (const file of selectedFiles) {
            const symbols = symbolsApi
              .getByFileIdLight(file.id)
              .sort((a, b) => {
                if (a.isExported !== b.isExported) return a.isExported ? -1 : 1;
                if (a.centrality !== b.centrality) return b.centrality - a.centrality;
                return a.startLine - b.startLine;
              })
              .slice(0, maxSymbolsPerFile);
            const symbolSummary = symbols.length > 0
              ? symbols.map((symbol) => `${compactKind(symbol.kind)} ${symbol.name}`).join(", ")
              : "no symbols";
            lines.push(`- ${file.path} :: ${symbolSummary}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: approximateTokenTrim(lines.join("\n"), maxTokens) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Repo map failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
