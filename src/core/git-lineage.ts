import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const logger = createLogger("git-lineage");
const FUNCTION_KINDS = ["function", "method", "arrow"] as const;
const SUMMARY_ITEM_LIMIT = 3;
const FILE_CHANGE_RE = /^([A-Z])(\d+)?\t([^\t]+)(?:\t([^\t]+))?$/;
const STRUCTURED_HEADER_RE = /^([0-9a-f]{7,40})\t([^\t]*)\t(\d+)\t(.+)$/i;
const ONELINE_HEADER_RE = /^([0-9a-f]{7,40})\s+(.+)$/i;
const TEMPORAL_GIT_TERMS = new Set([
  "why",
  "when",
  "history",
  "changed",
  "broke",
  "deprecated",
  "introduced",
  "who",
]);
const GIT_QUERY_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "by",
  "with",
  "was",
  "is",
  "are",
  "be",
  "been",
  "it",
  "this",
  "that",
  "did",
]);
const MAX_GIT_SEARCH_COMMITS = 200;

export interface GitCommitSearchResult {
  hash: string;
  author: string | null;
  timestamp: number | null;
  message: string;
  summary: string;
  filesChanged: string[];
  fileId: number | null;
  score: number;
}

export interface GitCommitFileChange {
  changeType: string;
  filePath: string;
  previousPath: string | null;
}

export interface GitLineageCommit {
  hash: string;
  author: string | null;
  timestamp: number | null;
  message: string;
  files: GitCommitFileChange[];
}

export interface GitLineageIndexResult {
  commitCount: number;
  fileChangeCount: number;
}

function normalizeGitQueryTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9_\-/\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 2)
    .filter((term) => !GIT_QUERY_STOP_WORDS.has(term));

  return [...new Set(terms)];
}

function scoreCommitAgainstQuery(
  query: string,
  terms: string[],
  row: { message: string; summary: string; filesChanged: string[] }
): number {
  if (terms.length === 0) return 0;

  const summaryLower = row.summary.toLowerCase();
  const messageLower = row.message.toLowerCase();
  const filesLower = row.filesChanged.map((file) => file.toLowerCase());
  const combinedFiles = filesLower.join(" ");
  const normalizedQuery = query.toLowerCase().trim();
  let score = 0;

  if (normalizedQuery.length >= 4) {
    if (summaryLower.includes(normalizedQuery)) score += 8;
    if (messageLower.includes(normalizedQuery)) score += 6;
  }

  for (const term of terms) {
    if (TEMPORAL_GIT_TERMS.has(term)) {
      score += summaryLower.includes(term) || messageLower.includes(term) ? 0.5 : 0;
      continue;
    }

    if (summaryLower.includes(term)) score += 5;
    if (messageLower.includes(term)) score += 4;
    if (combinedFiles.includes(term)) score += 6;

    const fileNameHits = filesLower.filter((file) => file.split("/").some((part) => part.includes(term))).length;
    score += Math.min(fileNameHits, 2) * 2;
  }

  return score;
}

/**
 * Detect whether a query is asking for temporal or causal history that should surface git context.
 */
export function isTemporalGitQuery(query: string): boolean {
  return normalizeGitQueryTerms(query).some((term) => TEMPORAL_GIT_TERMS.has(term));
}

/**
 * Search indexed git commits for the commits most relevant to a temporal/causal query.
 */
export function searchGitCommits(
  db: Database.Database,
  query: string,
  limit = 3
): GitCommitSearchResult[] {
  if (limit <= 0 || !isTemporalGitQuery(query)) return [];

  const terms = normalizeGitQueryTerms(query);
  if (terms.length === 0) return [];

  const rows = db.prepare(`
    SELECT hash, author, timestamp, message, summary, files_changed
    FROM git_commits
    ORDER BY timestamp DESC, hash DESC
    LIMIT ?
  `).all(MAX_GIT_SEARCH_COMMITS) as Array<{
    hash: string;
    author: string | null;
    timestamp: number | null;
    message: string;
    summary: string | null;
    files_changed: string | null;
  }>;

  const resolvePrimaryFile = db.prepare(`
    SELECT id, path
    FROM files
    WHERE path IN (SELECT value FROM json_each(?))
    ORDER BY id ASC
    LIMIT 1
  `);

  return rows
    .map((row) => {
      const filesChanged = (() => {
        try {
          const parsed = JSON.parse(row.files_changed ?? "[]");
          return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
        } catch {
          return [];
        }
      })();
      const summary = row.summary?.trim() || row.message;
      const score = scoreCommitAgainstQuery(query, terms, {
        message: row.message,
        summary,
        filesChanged,
      });
      if (score <= 0) {
        return null;
      }

      const fileRow = filesChanged.length > 0
        ? resolvePrimaryFile.get(JSON.stringify(filesChanged)) as { id: number; path: string } | undefined
        : undefined;

      return {
        hash: row.hash,
        author: row.author,
        timestamp: row.timestamp,
        message: row.message,
        summary,
        filesChanged,
        fileId: fileRow?.id ?? null,
        score,
      } satisfies GitCommitSearchResult;
    })
    .filter((row): row is GitCommitSearchResult => row !== null)
    .sort((a, b) => b.score - a.score || (b.timestamp ?? 0) - (a.timestamp ?? 0) || a.hash.localeCompare(b.hash))
    .slice(0, limit);
}

function finalizeCommit(commits: GitLineageCommit[], current: GitLineageCommit | null): void {
  if (!current) return;
  commits.push({
    ...current,
    files: [...current.files],
  });
}

function parseHeader(line: string): GitLineageCommit | null {
  const structured = line.match(STRUCTURED_HEADER_RE);
  if (structured) {
    return {
      hash: structured[1]!,
      author: structured[2] || null,
      timestamp: Number(structured[3]) * 1000,
      message: structured[4]!,
      files: [],
    };
  }

  const oneline = line.match(ONELINE_HEADER_RE);
  if (!oneline) return null;
  return {
    hash: oneline[1]!,
    author: null,
    timestamp: null,
    message: oneline[2]!,
    files: [],
  };
}

function parseFileChange(line: string): GitCommitFileChange | null {
  const match = line.match(FILE_CHANGE_RE);
  if (!match) return null;

  const changeType = match[1]!;
  if (changeType === "R" || changeType === "C") {
    return {
      changeType,
      previousPath: match[3]!,
      filePath: match[4] ?? match[3]!,
    };
  }

  return {
    changeType,
    previousPath: null,
    filePath: match[3]!,
  };
}

function formatSummaryList(values: string[], fallback: string): string {
  if (values.length === 0) return fallback;
  if (values.length <= SUMMARY_ITEM_LIMIT) return values.join(", ");
  return `${values.slice(0, SUMMARY_ITEM_LIMIT).join(", ")} +${values.length - SUMMARY_ITEM_LIMIT} more`;
}

function inferCommitType(message: string): string {
  const match = message.match(/^([a-z]+)(?:\([^)]+\))?!?:/i);
  return match?.[1]?.toLowerCase() ?? "chore";
}

function getChangedFunctionNames(db: Database.Database, filePaths: string[]): string[] {
  if (filePaths.length === 0) return [];

  const rows = db.prepare(`
    SELECT DISTINCT s.name
    FROM symbols s
    INNER JOIN files f ON f.id = s.file_id
    WHERE f.path IN (SELECT value FROM json_each(?))
      AND s.kind IN (${FUNCTION_KINDS.map(() => "?").join(", ")})
    ORDER BY s.name ASC
  `).all(JSON.stringify(filePaths), ...FUNCTION_KINDS) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

/**
 * Parse `git log --oneline --name-status`-style output into structured commits.
 */
export function parseGitLineageLog(logOutput: string): GitLineageCommit[] {
  const commits: GitLineageCommit[] = [];
  let current: GitLineageCommit | null = null;

  for (const rawLine of logOutput.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const fileChange = parseFileChange(line);
    if (fileChange && current) {
      current.files.push(fileChange);
      continue;
    }

    const header = parseHeader(line);
    if (!header) continue;

    finalizeCommit(commits, current);
    current = header;
  }

  finalizeCommit(commits, current);
  return commits;
}

/**
 * Build the required template summary for a parsed git commit using indexed symbol names when available.
 */
export function buildGitCommitSummary(db: Database.Database, commit: GitLineageCommit): string {
  const uniqueFiles = [...new Set(commit.files.map((file) => file.filePath))].sort((a, b) => a.localeCompare(b));
  const functionNames = getChangedFunctionNames(db, uniqueFiles);
  const type = inferCommitType(commit.message);
  const functionsPart = formatSummaryList(functionNames, "files");
  const filesPart = formatSummaryList(uniqueFiles, "no files");
  return `[${type}] Changed ${functionsPart} in ${filesPart} — ${commit.message}`;
}

/**
 * Read git history for a repository, parse commit/file changes, and persist them into git history tables.
 */
export async function indexGitLineage(
  db: Database.Database,
  projectRoot: string
): Promise<GitLineageIndexResult> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      "--name-status",
      "--date-order",
      "--pretty=format:%H%x09%an%x09%at%x09%s",
    ],
    { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 }
  );

  const commits = parseGitLineageLog(stdout);
  const insertCommit = db.prepare(`
    INSERT INTO git_commits (hash, author, timestamp, message, summary, files_changed)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFile = db.prepare(`
    INSERT INTO git_commit_files (commit_hash, file_path, change_type)
    VALUES (?, ?, ?)
  `);

  const writeAll = db.transaction((rows: GitLineageCommit[]) => {
    db.prepare("DELETE FROM git_commit_files").run();
    db.prepare("DELETE FROM git_commits").run();

    for (const commit of rows) {
      const uniqueFiles = [...new Set(commit.files.map((file) => file.filePath))].sort((a, b) => a.localeCompare(b));
      insertCommit.run(
        commit.hash,
        commit.author,
        commit.timestamp,
        commit.message,
        buildGitCommitSummary(db, commit),
        JSON.stringify(uniqueFiles)
      );

      for (const file of commit.files) {
        insertFile.run(commit.hash, file.filePath, file.changeType);
      }
    }
  });

  writeAll(commits);
  logger.info("indexed git lineage", {
    projectRoot,
    commits: commits.length,
    fileChanges: commits.reduce((total, commit) => total + commit.files.length, 0),
  });

  return {
    commitCount: commits.length,
    fileChangeCount: commits.reduce((total, commit) => total + commit.files.length, 0),
  };
}
