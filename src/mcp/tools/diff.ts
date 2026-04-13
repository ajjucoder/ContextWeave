import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod/v3";
import { isPathWithinRoot } from "../../core/indexer.js";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { getRegisterTool } from "./register-helper.js";
import { toProjectRelativePath } from "./path-filters.js";

const execFileAsync = promisify(execFile);
const GIT_DIFF_MAX_BUFFER = 10 * 1024 * 1024;

type DiffStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "unknown";

type DiffFile = {
  path: string;
  previousPath: string | null;
  status: DiffStatus;
  staged: boolean;
  unstaged: boolean;
  added: number | null;
  deleted: number | null;
  indexed: boolean;
  language: string | null;
  symbols: string[];
};

type DiffCandidate = {
  path: string;
  previousPath: string | null;
  status: DiffStatus;
  staged: boolean;
  unstaged: boolean;
};

function parseNumStat(stdout: string): Map<string, { added: number | null; deleted: number | null }> {
  const stats = new Map<string, { added: number | null; deleted: number | null }>();

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? null : Number(parts[0]);
    const deleted = parts[1] === "-" ? null : Number(parts[1]);
    const path = (parts[parts.length - 1] || "").trim();
    if (!path) continue;
    stats.set(path, {
      added: Number.isFinite(added) ? added : null,
      deleted: Number.isFinite(deleted) ? deleted : null,
    });
  }

  return stats;
}

function statusFromCode(code: string): DiffStatus {
  if (code === "??") return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("C")) return "copied";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("M")) return "modified";
  return "unknown";
}

function parsePorcelain(stdout: string): DiffCandidate[] {
  const files: DiffCandidate[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;

    let path = rawPath;
    let previousPath: string | null = null;
    if (rawPath.includes(" -> ")) {
      const [fromPath, toPath] = rawPath.split(" -> ");
      previousPath = fromPath?.trim() || null;
      path = toPath?.trim() || rawPath;
    }

    files.push({
      path,
      previousPath,
      status: statusFromCode(code),
      staged: code[0] !== " " && code !== "??",
      unstaged: code[1] !== " ",
    });
  }

  return files;
}

function parseNameStatus(stdout: string): DiffCandidate[] {
  const files: DiffCandidate[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const code = parts[0] || "";
    const status = statusFromCode(code);

    if ((status === "renamed" || status === "copied") && parts.length >= 3) {
      files.push({
        path: parts[2]!.trim(),
        previousPath: parts[1]!.trim(),
        status,
        staged: true,
        unstaged: false,
      });
      continue;
    }

    files.push({
      path: parts[1]!.trim(),
      previousPath: null,
      status,
      staged: true,
      unstaged: false,
    });
  }

  return files;
}

function resolveScope(projectRoot: string, inputPath?: string): string | null {
  const trimmed = inputPath?.trim();
  if (!trimmed) return null;

  const absolute = resolve(projectRoot, trimmed);
  if (!isPathWithinRoot(absolute, projectRoot)) {
    throw new Error(`path "${inputPath}" is outside the project root`);
  }

  const relativePath = toProjectRelativePath(projectRoot, absolute);
  return relativePath || null;
}

async function runGit(projectRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectRoot,
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  return stdout;
}

async function getBranchName(projectRoot: string): Promise<string | null> {
  try {
    const stdout = await runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = stdout.trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

function enrichFiles(
  db: Database.Database,
  candidates: DiffCandidate[],
  stats: Map<string, { added: number | null; deleted: number | null }>,
  maxFiles: number
): DiffFile[] {
  const filesApi = fileQueries(db);
  const symbolsApi = symbolQueries(db);

  return candidates.slice(0, maxFiles).map((candidate) => {
    const indexedFile = filesApi.getByPath(candidate.path)
      ?? filesApi.getByPathSuffix(candidate.path)
      ?? (candidate.previousPath ? filesApi.getByPath(candidate.previousPath) ?? filesApi.getByPathSuffix(candidate.previousPath) : undefined);
    const indexedSymbols = indexedFile ? symbolsApi.getByFileIdLight(indexedFile.id) : [];
    const stat = stats.get(candidate.path) ?? (candidate.previousPath ? stats.get(candidate.previousPath) : undefined);

    return {
      path: candidate.path,
      previousPath: candidate.previousPath,
      status: candidate.status,
      staged: candidate.staged,
      unstaged: candidate.unstaged,
      added: stat?.added ?? null,
      deleted: stat?.deleted ?? null,
      indexed: Boolean(indexedFile),
      language: indexedFile?.language ?? null,
      symbols: indexedSymbols
        .sort((a, b) => a.startLine - b.startLine || b.centrality - a.centrality)
        .slice(0, 12)
        .map((symbol) => symbol.name),
    };
  });
}

async function collectWorkingTreeDiff(projectRoot: string, base: string, scope: string | null): Promise<{
  candidates: DiffCandidate[];
  stats: Map<string, { added: number | null; deleted: number | null }>;
}> {
  const statusArgs = ["status", "--short", "--untracked-files=all"];
  if (scope) statusArgs.push("--", scope);

  const diffArgs = ["diff", "--numstat", "-M", base];
  if (scope) diffArgs.push("--", scope);

  const [statusOut, statOut] = await Promise.all([
    runGit(projectRoot, statusArgs),
    runGit(projectRoot, diffArgs),
  ]);

  return {
    candidates: parsePorcelain(statusOut),
    stats: parseNumStat(statOut),
  };
}

async function collectStagedDiff(projectRoot: string, base: string, scope: string | null): Promise<{
  candidates: DiffCandidate[];
  stats: Map<string, { added: number | null; deleted: number | null }>;
}> {
  const nameArgs = ["diff", "--cached", "--name-status", "-M", base];
  const statArgs = ["diff", "--cached", "--numstat", "-M", base];
  if (scope) {
    nameArgs.push("--", scope);
    statArgs.push("--", scope);
  }

  const [nameOut, statOut] = await Promise.all([
    runGit(projectRoot, nameArgs),
    runGit(projectRoot, statArgs),
  ]);

  return {
    candidates: parseNameStatus(nameOut),
    stats: parseNumStat(statOut),
  };
}

export function registerDiffTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);
  const inputSchema: Record<string, z.ZodTypeAny> = {
    base: z.string().optional().describe("Git base revision to diff against (default: HEAD)"),
    path: z.string().optional().describe("Optional file or directory scope inside the project"),
    staged_only: z.boolean().optional().describe("Only show staged changes"),
    max_files: z.number().min(1).max(500).optional().describe("Max changed files to return (default: 50)"),
  };

  registerTool(
    "cw_diff",
    "Return current git changes with file status, line stats, and indexed symbols for changed files.",
    inputSchema,
    async ({
      base,
      path,
      staged_only,
      max_files,
    }: {
      base?: string;
      path?: string;
      staged_only?: boolean;
      max_files?: number;
    }) => {
      try {
        const resolvedRoot = resolve(projectRoot);
        const resolvedScope = resolveScope(resolvedRoot, path);
        const diffBase = base?.trim() || "HEAD";
        const stagedOnly = staged_only ?? false;
        const maxFiles = max_files ?? 50;

        const [{ candidates, stats }, branch] = await Promise.all([
          stagedOnly
            ? collectStagedDiff(resolvedRoot, diffBase, resolvedScope)
            : collectWorkingTreeDiff(resolvedRoot, diffBase, resolvedScope),
          getBranchName(resolvedRoot),
        ]);

        const files = enrichFiles(db, candidates, stats, maxFiles);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              branch,
              base: diffBase,
              stagedOnly,
              scope: resolvedScope ?? ".",
              fileCount: files.length,
              files,
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Diff failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
