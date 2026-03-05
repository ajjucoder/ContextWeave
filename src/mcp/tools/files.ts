import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fileQueries } from "../../db/queries/files.js";
import { globToRegExp, toProjectRelativePath, withinPath } from "./path-filters.js";

function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerFilesTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    pattern: z.string().optional().describe("Glob-like file pattern, e.g. **/*.ts or src/**/*.test.ts"),
    path: z.string().optional().describe("Directory scope inside project"),
    max_results: z.number().min(1).max(500).optional().describe("Max results to return (default: 50)"),
  };

  registerTool(
    "cw_files",
    "List indexed files with metadata, with optional pattern/path filters.",
    inputSchema,
    async ({ pattern, path, max_results }: { pattern?: string; path?: string; max_results?: number }) => {
      try {
        const filesApi = fileQueries(db);
        const basePath = path?.trim();
        const maxResults = max_results ?? 50;

        const regex = pattern && pattern.trim().length > 0 ? globToRegExp(pattern.trim()) : null;

        const filtered: ReturnType<typeof filesApi.getAll> = [];
        for (const file of filesApi.iterateAll()) {
          const relPath = toProjectRelativePath(projectRoot, file.path);
          if (!withinPath(relPath, basePath)) continue;
          if (regex && !regex.test(relPath)) continue;
          filtered.push(file);
          if (filtered.length >= maxResults) break;
        }

        const lines: string[] = [
          "Indexed Files",
          `Project: ${projectRoot}`,
          `Scope: ${basePath ?? "."}`,
          `Pattern: ${pattern?.trim() || "(none)"}`,
          `Results: ${filtered.length}${filtered.length === maxResults ? ` (capped at ${maxResults})` : ""}`,
          "",
        ];

        if (filtered.length === 0) {
          lines.push("No indexed files matched.");
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
          };
        }

        for (const file of filtered) {
          let sizeBytes: number | null = null;
          try {
            sizeBytes = statSync(resolve(projectRoot, file.path)).size;
          } catch {
            sizeBytes = null;
          }

          const errorTag = file.error ? ` | error: ${file.error}` : "";
          const indexedAt = new Date(file.lastIndexed).toISOString();
          const mtime = file.mtime > 0 ? new Date(file.mtime).toISOString() : "n/a";

          lines.push(
            `- ${file.path} | lang: ${file.language} | symbols: ${file.symbolCount} | size: ${formatBytes(sizeBytes)} | indexed: ${indexedAt} | mtime: ${mtime}${errorTag}`
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Files listing failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
