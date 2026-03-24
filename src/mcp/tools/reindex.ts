import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { indexDirectory, indexProject, indexProjectRoots, indexSingleFile, isPathWithinRoot } from "../../core/indexer.js";
import type { EmbeddingRuntime } from "../../core/types.js";
import { runPageRankInBackground } from "../../core/graph.js";
import { createLogger } from "../../utils/logger.js";
import type { ProjectConfig } from "../../utils/config.js";
import { getRegisterTool } from "./register-helper.js";
import { syncBootstrapObservations } from "../../memory/bootstrap.js";

const log = createLogger("reindex-tool");

export function registerReindexTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  config?: ProjectConfig,
  embeddingRuntime?: EmbeddingRuntime | null
): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_reindex",
    "Force reindex a file, directory, or the entire project. Updates the AST graph and centrality scores.",
    {
      path: z.string().optional().describe("Specific file or directory to reindex (omit for full project)"),
      paths: z.array(z.string()).min(1).optional().describe("Multiple project roots to index into the shared graph"),
    },
    async ({ path, paths }: { path?: string; paths?: string[] }) => {
      try {
        const startTime = Date.now();
        const dbPath = resolve(projectRoot, ".contextweave", "contextweave.db");

        if (path && paths && paths.length > 0) {
          return {
            content: [{ type: "text" as const, text: "Error: provide either path or paths, not both" }],
            isError: true,
          };
        }

        if (paths && paths.length > 0) {
          const resolvedRoots = paths.map((entry) => ({
            input: entry,
            fullPath: resolve(projectRoot, entry),
          }));
          for (const root of resolvedRoots) {
            if (!existsSync(root.fullPath)) {
              return {
                content: [{ type: "text" as const, text: `Error: path "${root.input}" does not exist` }],
                isError: true,
              };
            }
            if (!statSync(root.fullPath).isDirectory()) {
              return {
                content: [{ type: "text" as const, text: `Error: path "${root.input}" is not a directory` }],
                isError: true,
              };
            }
          }

          const result = await indexProjectRoots(db, projectRoot, resolvedRoots.map((root) => root.fullPath), config?.ignore, {
            embeddings: embeddingRuntime,
          });
          syncBootstrapObservations(db, projectRoot);
          runPageRankInBackground(dbPath);
          const elapsed = Date.now() - startTime;
          return {
            content: [{
              type: "text" as const,
              text: `Reindexed ${resolvedRoots.length} repos: ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)${result.errors.length > 0 ? `\n${result.errors.length} errors` : ""}`,
            }],
          };
        }

        if (path) {
          const fullPath = resolve(projectRoot, path);

          if (!isPathWithinRoot(fullPath, projectRoot)) {
            return {
              content: [{ type: "text" as const, text: `Error: path "${path}" is outside the project root` }],
              isError: true,
            };
          }

          let isDirectory = false;
          try {
            isDirectory = statSync(fullPath).isDirectory();
          } catch {
            return {
              content: [{ type: "text" as const, text: `Error: path "${path}" does not exist` }],
              isError: true,
            };
          }

          if (isDirectory) {
            const result = await indexDirectory(db, fullPath, projectRoot, config?.ignore, {
              embeddings: embeddingRuntime,
            });
            syncBootstrapObservations(db, projectRoot);
            runPageRankInBackground(dbPath);
            const elapsed = Date.now() - startTime;
            return {
              content: [{
                type: "text" as const,
                text: `Reindexed ${path}: ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)${result.errors.length > 0 ? `\nErrors: ${result.errors.join(", ")}` : ""}`,
              }],
            };
          }

          const result = await indexSingleFile(db, fullPath, projectRoot, undefined, {
            embeddings: embeddingRuntime,
          });
          syncBootstrapObservations(db, projectRoot);
          runPageRankInBackground(dbPath);
          const elapsed = Date.now() - startTime;

          return {
            content: [{
              type: "text" as const,
              text: `Reindexed ${path}: ${result.symbolCount} symbols (${elapsed}ms)${result.errors.length > 0 ? `\nErrors: ${result.errors.join(", ")}` : ""}`,
            }],
          };
        }

        const result = await indexProject(db, projectRoot, config?.ignore, {
          embeddings: embeddingRuntime,
        });
        syncBootstrapObservations(db, projectRoot);
        runPageRankInBackground(dbPath);
        const elapsed = Date.now() - startTime;

        log.info(`full reindex completed in ${elapsed}ms`);

        return {
          content: [{
            type: "text" as const,
            text: `Reindexed project: ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)${result.errors.length > 0 ? `\n${result.errors.length} errors` : ""}`,
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("reindex failed", { error: message });
        return {
          content: [{ type: "text" as const, text: `Reindex failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
