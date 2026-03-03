import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { countStaleFiles, fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { searchFilesByQuery } from "../../core/file-summaries.js";
import { toProjectRelativePath, withinPath } from "./path-filters.js";

interface OverviewFile {
  id: number;
  path: string;
  symbolCount: number;
}

interface QueryRow {
  name: string;
  kind: string;
  path: string;
  start_line: number;
}

function formatTree(files: OverviewFile[], depth: number, maxLines: number): string[] {
  const counts = new Map<string, { files: number; symbols: number }>();

  for (const file of files) {
    const parts = file.path.split("/");
    const maxDepth = Math.min(depth, Math.max(1, parts.length - 1));

    for (let i = 1; i <= maxDepth; i++) {
      const key = parts.slice(0, i).join("/");
      const existing = counts.get(key) ?? { files: 0, symbols: 0 };
      existing.files += 1;
      existing.symbols += file.symbolCount;
      counts.set(key, existing);
    }
  }

  const rows = [...counts.entries()]
    .map(([path, stat]) => ({
      path,
      depth: path.split("/").length,
      files: stat.files,
      symbols: stat.symbols,
    }))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.path !== b.path) return a.path.localeCompare(b.path);
      return b.symbols - a.symbols;
    })
    .slice(0, maxLines);

  return rows.map((row) => `${"  ".repeat(row.depth - 1)}- ${row.path} (${row.files} files, ${row.symbols} symbols)`);
}

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

export function registerOverviewTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    path: z.string().optional().describe("Directory scope inside project (default: project root)"),
    depth: z.number().min(1).max(8).optional().describe("Directory summary depth (default: 2)"),
    max_tokens: z.number().min(200).max(8000).optional().describe("Approx output token cap (default: 2000)"),
    query: z.string().optional().describe("Optional query for a focused section"),
  };

  registerTool(
    "cw_overview",
    "Show a compact index overview with optional query-focused matches.",
    inputSchema,
    async ({ path, depth, max_tokens, query }: { path?: string; depth?: number; max_tokens?: number; query?: string }) => {
      try {
        const filesApi = fileQueries(db);
        const symbolsApi = symbolQueries(db);
        const edgesApi = edgeQueries(db);

        const basePath = path?.trim();
        const maxDepth = depth ?? 2;
        const maxTokens = max_tokens ?? 2000;

        const files = filesApi
          .getAll()
          .map((file) => ({
            id: file.id,
            path: toProjectRelativePath(projectRoot, file.path),
            symbolCount: file.symbolCount,
          }))
          .filter((file) => withinPath(file.path, basePath));

        const totalSymbols = files.reduce((sum, file) => sum + file.symbolCount, 0);
        const globalSymbols = symbolsApi.count();

        const staleCount = countStaleFiles(db);
        const staleNote = staleCount > 0
          ? ` [${staleCount} stale — run cw_reindex]`
          : "";

        const lines: string[] = [
          "ContextWeave Overview",
          `Project: ${projectRoot}`,
          `Scope: ${basePath ?? "."}`,
          `Indexed Files: ${files.length}${staleNote}`,
          `Indexed Symbols: ${totalSymbols} (global: ${globalSymbols})`,
          `Global Edges: ${edgesApi.count()}`,
        ];

        if (files.length === 0) {
          lines.push("", "No indexed files found for this scope.");
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        lines.push("", `Directory Summary (depth ${maxDepth}):`);
        lines.push(...formatTree(files, maxDepth, 24));

        const topFiles = [...files].sort((a, b) => b.symbolCount - a.symbolCount || a.path.localeCompare(b.path)).slice(0, 10);
        lines.push("", "Top Files by Symbol Count:");
        for (const file of topFiles) {
          lines.push(`- ${file.path} (${file.symbolCount} symbols)`);
        }

        if (query && query.trim().length > 0) {
          const queryTerm = query.trim();
          const focusedFiles = searchFilesByQuery(db, queryTerm, 8).filter((row) =>
            withinPath(toProjectRelativePath(projectRoot, row.path), basePath)
          );
          lines.push("", `Query Focus: \"${queryTerm}\"`);

          if (focusedFiles.length === 0) {
            lines.push("- No focused file matches found.");
          } else {
            const symbolStmt = db.prepare(`
              SELECT s.name, s.kind, f.path, s.start_line
              FROM symbols s
              JOIN files f ON f.id = s.file_id
              WHERE s.name LIKE ? ESCAPE '\\'
                AND f.id = ?
              ORDER BY s.centrality DESC, s.name ASC
              LIMIT 3
            `);

            const escaped = queryTerm.replace(/[\\%_]/g, "\\$&");
            for (const file of focusedFiles) {
              lines.push(`- ${file.path}`);

              const rows = symbolStmt.all(`%${escaped}%`, file.fileId) as QueryRow[];
              if (rows.length === 0) {
                lines.push("  · no direct symbol name match");
                continue;
              }

              for (const row of rows) {
                lines.push(`  · ${row.kind} ${row.name} (${toProjectRelativePath(projectRoot, row.path)}:${row.start_line})`);
              }
            }
          }
        }

        const trimmed = approximateTokenTrim(lines.join("\n"), maxTokens);

        return {
          content: [{ type: "text" as const, text: trimmed }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Overview failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
