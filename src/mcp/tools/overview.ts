import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { countStaleFiles, fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { searchFilesByQuery } from "../../core/file-summaries.js";
import { classifyQueryIntent } from "../../capsule/intent-classifier.js";
import { hybridSearch } from "../../core/hybrid-ranker.js";
import { toProjectRelativePath, withinPath } from "./path-filters.js";
import { getRegisterTool } from "./register-helper.js";
import {
  computeFollowUpMetrics,
  FOLLOW_UP_METRICS_SAMPLE_LIMIT,
  formatRatePct,
} from "./stats.js";
import type { EmbeddingRuntime } from "../../core/types.js";
import { loadConventions, formatConventionSummary } from "../../core/convention-graph.js";

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

interface SummaryRow {
  summary_text: string;
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

export function registerOverviewTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  embeddingRuntime?: EmbeddingRuntime | null
): void {
  let symbolStmt: Database.Statement<[string, number], QueryRow> | null = null;
  let summaryStmt: Database.Statement<[number], SummaryRow> | null = null;
  const getSymbolStmt = () => {
    if (!symbolStmt) {
      symbolStmt = db.prepare<[string, number], QueryRow>(`
        SELECT s.name, s.kind, f.path, s.start_line
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.name LIKE ? ESCAPE '\\'
          AND f.id = ?
        ORDER BY s.centrality DESC, s.name ASC
        LIMIT 3
      `);
    }
    return symbolStmt;
  };
  const getSummaryStmt = () => {
    if (!summaryStmt) {
      summaryStmt = db.prepare<[number], SummaryRow>(`
        SELECT summary_text
        FROM file_summaries
        WHERE file_id = ?
      `);
    }
    return summaryStmt;
  };

  const splitCamelCase = (token: string): string[] => {
    const parts = token.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    return parts.length > 1 ? [token, ...parts.map((p) => p.toLowerCase())] : [token];
  };

  const buildSummarySnippet = (summaryText: string, queryTerm: string): string | null => {
    const summaryTokens = summaryText
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const rawQueryTokens = queryTerm
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2);
    const queryTokens = Array.from(
      new Set(rawQueryTokens.flatMap((t) => splitCamelCase(t)))
    );
    if (summaryTokens.length === 0 || queryTokens.length === 0) return null;

    const firstMatch = summaryTokens.findIndex((token) => queryTokens.includes(token));
    if (firstMatch === -1) return null;

    const start = Math.max(0, firstMatch - 1);
    const end = Math.min(summaryTokens.length, start + 10);
    return summaryTokens.slice(start, end).join(" ");
  };

  const registerTool = getRegisterTool(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    path: z.string().optional().describe("Directory scope inside project (default: project root)"),
    depth: z.number().min(1).max(8).optional().describe("Directory summary depth (default: 2)"),
    max_tokens: z.number().min(200).max(8000).optional().describe("Approx output token cap (default: 2000)"),
    query: z.string().max(2000).optional().describe("Optional query for a focused section"),
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
        const rateSample = capsuleLogQueries(db).getRecent(FOLLOW_UP_METRICS_SAMPLE_LIMIT);
        const followUpMetrics = computeFollowUpMetrics(rateSample);

        const lines: string[] = [
          "ContextWeave Overview",
          `Project: ${projectRoot}`,
          `Scope: ${basePath ?? "."}`,
          `Indexed Files: ${files.length}${staleNote}`,
          `Indexed Symbols: ${totalSymbols} (global: ${globalSymbols})`,
          `Global Edges: ${edgesApi.count()}`,
          `First-pass rate: ${formatRatePct(followUpMetrics.firstPassRate)} (${followUpMetrics.sampleSize} capsules)`,
          `Correction rate: ${formatRatePct(followUpMetrics.correctionRate)} (${followUpMetrics.sampleSize} capsules)`,
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

        const fileIdToPath = new Map(files.map((f) => [f.id, f.path]));
        const entryPoints = symbolsApi
          .getExported()
          .filter((s) => fileIdToPath.has(s.fileId))
          .sort((a, b) => b.centrality - a.centrality)
          .slice(0, 10);
        if (entryPoints.length > 0) {
          lines.push("", "Key Entry Points:");
          for (const sym of entryPoints) {
            const filePath = fileIdToPath.get(sym.fileId) ?? "";
            lines.push(`- ${sym.kind} ${sym.name} (${filePath}:${sym.startLine})`);
          }
        }

        const conventionGraph = loadConventions(db);
        if (conventionGraph.conventions.length > 0) {
          lines.push("", ...formatConventionSummary(conventionGraph));
        }

        if (query && query.trim().length > 0) {
          const queryTerm = query.trim();
          let focusedFiles = searchFilesByQuery(db, queryTerm, 8, projectRoot).filter((row) =>
            withinPath(toProjectRelativePath(projectRoot, row.path), basePath)
          );
          const hybridResultsByFile = new Map<number, Awaited<ReturnType<typeof hybridSearch>>[number][]>();

          if (embeddingRuntime) {
            try {
              const classified = classifyQueryIntent(queryTerm);
              const queryTerms = classified.focusTerms.length > 0
                ? classified.focusTerms
                : classified.normalizedTerms.length > 0
                  ? classified.normalizedTerms
                  : queryTerm.split(/\s+/).filter((token) => token.length > 1);
              const queryEmbedding = await embeddingRuntime.embedder.embed(queryTerm);
              const hybridResults = await hybridSearch(db, embeddingRuntime, {
                query: queryTerm,
                queryTerms,
                queryEmbedding,
                projectRoot,
                pathRestriction: basePath,
                limit: 8,
              });
              for (const result of hybridResults) {
                const existing = hybridResultsByFile.get(result.fileId) ?? [];
                existing.push(result);
                hybridResultsByFile.set(result.fileId, existing);
              }
              if (hybridResults.length > 0) {
                const lexicalTail = focusedFiles;
                const seenFileIds = new Set<number>();
                focusedFiles = hybridResults
                  .filter((result) => {
                    if (seenFileIds.has(result.fileId)) return false;
                    seenFileIds.add(result.fileId);
                    return true;
                  })
                  .map((result) => ({
                    fileId: result.fileId,
                    path: result.filePath,
                  }))
                  .concat(
                    lexicalTail.filter((row) => {
                      if (seenFileIds.has(row.fileId)) return false;
                      seenFileIds.add(row.fileId);
                      return true;
                    })
                  );
              }
            } catch {
              // Fall back to lexical overview matches if query embedding is unavailable.
            }
          }
          lines.push("", `Query Focus: \"${queryTerm}\"`);

          if (focusedFiles.length === 0) {
            lines.push("No files matched this query.");
            lines.push(`- Suggested: cw_capsule(query: "${queryTerm}") for deeper context`);
            lines.push(`- Or: cw_grep(query: "${queryTerm}") for exact text matches`);
          } else {
            const escaped = queryTerm.replace(/[\\%_]/g, "\\$&");
            for (const file of focusedFiles) {
              const relativePath = toProjectRelativePath(projectRoot, file.path);
              lines.push(`- ${relativePath}`);

              const rows = getSymbolStmt().all(`%${escaped}%`, file.fileId);
              if (rows.length === 0) {
                const hybridChunks = hybridResultsByFile.get(file.fileId) ?? [];
                if (hybridChunks.length > 0) {
                  for (const chunk of hybridChunks.slice(0, 2)) {
                    const entityLabel = chunk.scopeChain[chunk.scopeChain.length - 1] ?? chunk.kind;
                    lines.push(`  · hybrid match: ${entityLabel} (${relativePath}:${chunk.startLine}-${chunk.endLine})`);
                  }
                  continue;
                }
                const summaryText = getSummaryStmt().get(file.fileId)?.summary_text ?? "";
                const snippet = buildSummarySnippet(summaryText, queryTerm);
                if (snippet) {
                  lines.push(`  · summary match: ${snippet}`);
                } else {
                  lines.pop();
                }
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
