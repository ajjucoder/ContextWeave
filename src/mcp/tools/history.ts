/**
 * Git-history MCP tool helpers for file-level and symbol-level commit lookups.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod/v3";
import { parseGitLineageLog } from "../../core/git-lineage.js";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { getRegisterTool } from "./register-helper.js";
import { isSafeProjectPath, toProjectRelativePath } from "./path-filters.js";

const execFileAsync = promisify(execFile);
const GIT_LOG_MAX_BUFFER = 10 * 1024 * 1024;

export interface HistoryEntry {
  hash: string;
  author: string | null;
  timestamp: number | null;
  message: string;
  summary: string;
  filesChanged: string[];
}

interface HistoryTarget {
  absolutePath: string;
  relativePath: string;
  fileId: number | null;
}

function parseStructuredGitHeaders(output: string): HistoryEntry[] {
  const headerRe = /^([0-9a-f]{7,40})\t([^\t]*)\t(\d+)\t(.+)$/i;
  const entries: HistoryEntry[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(headerRe);
    if (!match) continue;
    entries.push({
      hash: match[1]!,
      author: match[2] || null,
      timestamp: Number(match[3]) * 1000,
      message: match[4]!,
      summary: match[4]!,
      filesChanged: [],
    });
  }

  return entries;
}

function resolveHistoryTarget(
  db: Database.Database,
  projectRoot: string,
  requestedFile: string
): HistoryTarget {
  const trimmed = requestedFile.trim();
  if (!trimmed) {
    throw new Error("file is required");
  }

  const filesApi = fileQueries(db);
  const indexedMatch = filesApi.getByPath(trimmed)
    ?? filesApi.getByPath(toProjectRelativePath(projectRoot, trimmed))
    ?? filesApi.getByPathSuffix(trimmed);

  if (indexedMatch) {
    const absolutePath = resolve(projectRoot, indexedMatch.path);
    return {
      absolutePath,
      relativePath: indexedMatch.path.replace(/\\/g, "/"),
      fileId: indexedMatch.id,
    };
  }

  const absolutePath = resolve(projectRoot, trimmed);
  if (!isSafeProjectPath(absolutePath, resolve(projectRoot))) {
    throw new Error(`file "${requestedFile}" is outside the project root`);
  }

  const stat = statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`"${requestedFile}" is not a file`);
  }

  return {
    absolutePath,
    relativePath: relative(resolve(projectRoot), absolutePath).replace(/\\/g, "/"),
    fileId: null,
  };
}

function loadIndexedSummaries(db: Database.Database, hashes: string[]): Map<string, string> {
  if (hashes.length === 0) return new Map();

  const placeholders = hashes.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT hash, summary
    FROM git_commits
    WHERE hash IN (${placeholders})
  `).all(...hashes) as Array<{ hash: string; summary: string | null }>;

  return new Map(rows.map((row) => [row.hash, row.summary?.trim() || ""]));
}

async function getFileHistory(
  db: Database.Database,
  projectRoot: string,
  target: HistoryTarget
): Promise<HistoryEntry[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      "--follow",
      "--name-status",
      "--date-order",
      "--pretty=format:%H%x09%an%x09%at%x09%s",
      "--",
      target.relativePath,
    ],
    { cwd: projectRoot, maxBuffer: GIT_LOG_MAX_BUFFER }
  );

  const parsed = parseGitLineageLog(stdout).map((commit) => ({
    hash: commit.hash,
    author: commit.author,
    timestamp: commit.timestamp,
    message: commit.message,
    summary: commit.message,
    filesChanged: [...new Set(commit.files.map((file) => file.filePath))].sort((a, b) => a.localeCompare(b)),
  }));

  const summaries = loadIndexedSummaries(db, parsed.map((entry) => entry.hash));
  return parsed.map((entry) => ({
    ...entry,
    summary: summaries.get(entry.hash) || entry.message,
  }));
}

async function getSymbolHistory(
  db: Database.Database,
  projectRoot: string,
  target: HistoryTarget,
  symbolName: string
): Promise<HistoryEntry[]> {
  if (target.fileId === null) {
    throw new Error(`symbol history requires "${target.relativePath}" to be indexed; run cw_reindex first`);
  }

  const symbol = symbolQueries(db).getByFileAndName(target.fileId, symbolName);
  if (!symbol) {
    throw new Error(`no indexed symbol named "${symbolName}" found in ${target.relativePath}`);
  }

  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      "-L",
      `${symbol.startLine},${symbol.endLine}:${target.relativePath}`,
      "--no-patch",
      "--date-order",
      "--pretty=format:%H%x09%an%x09%at%x09%s",
    ],
    { cwd: projectRoot, maxBuffer: GIT_LOG_MAX_BUFFER }
  );

  const parsed = parseStructuredGitHeaders(stdout);
  const summaries = loadIndexedSummaries(db, parsed.map((entry) => entry.hash));
  return parsed.map((entry) => ({
    ...entry,
    summary: summaries.get(entry.hash) || entry.message,
    filesChanged: [target.relativePath],
  }));
}

/**
 * Registers cw_history, a git-history lookup tool for indexed project files and symbols.
 */
export function registerHistoryTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_history",
    "Return git commit history for a file, or for a specific indexed symbol within that file.",
    {
      file: z.string().describe("File path inside the project"),
      symbol: z.string().optional().describe("Optional symbol name for symbol-specific history"),
    },
    async ({ file, symbol }: { file: string; symbol?: string }) => {
      try {
        const resolvedRoot = resolve(projectRoot);
        const target = resolveHistoryTarget(db, resolvedRoot, file);
        const history = symbol?.trim()
          ? await getSymbolHistory(db, resolvedRoot, target, symbol.trim())
          : await getFileHistory(db, resolvedRoot, target);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              file: target.relativePath,
              symbol: symbol?.trim() || null,
              commitCount: history.length,
              commits: history,
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `History failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
