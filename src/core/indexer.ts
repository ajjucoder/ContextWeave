import { readFileSync, statSync, lstatSync, realpathSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { resolve, relative, sep, dirname, join, extname } from "node:path";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { ParsedSymbol, SymbolRecord, IndexDiff, ParseResult, PreparedChunk, EmbeddingRuntime } from "./types.js";
import { parseFile, detectLanguage } from "./parser.js";
import { hashFile } from "../utils/hash.js";
import { fileQueries } from "../db/queries/files.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { chunkQueries } from "../db/queries/chunks.js";
import { createLogger } from "../utils/logger.js";
import { isFrameworkEntryPath } from "../utils/path-retrieval.js";
import { upsertFileSummary, backfillSummariesIfNeeded } from "./file-summaries.js";
import { computeClusters, backfillClustersIfNeeded } from "./clusters.js";
import { backfillChunksIfNeeded, buildEmbeddingChunks } from "./chunker.js";
import { detectPatterns, backfillPatternsIfNeeded } from "./pattern-detector.js";
import { profileRepo, persistProfile } from "./repo-profiler.js";
import { buildConventionGraph, persistConventions } from "./convention-graph.js";
import { loadTsconfigPaths, resolveAliasedImport, type TsconfigPaths } from "../utils/tsconfig-paths.js";
import { resolveFrameworkTargets } from "../frameworks/registry.js";
import { synthesizeEventEdges } from "./event-edge-synthesis.js";

const log = createLogger("indexer");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_EDGE_TARGETS_PER_REFERENCE = 24;
const MAX_IMPORT_EDGE_SOURCES = 8;
const MAX_GLOBAL_FALLBACK_TARGETS = 12;
const IMPORT_RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

export const BUILTIN_IGNORE_PATTERNS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".contextweave",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
  "venv",
  ".venv",
  "target",
  ".tox",
  "vendor",
  ".bundle",
  ".claude",
  ".worktrees",
  "__fixtures__",
  "__snapshots__",
];

interface WorkerFileParseResult {
  filePath: string;
  content: string;
  mtime: number;
  hash: string;
  language: string;
  parsedAt: number;
  parseResult: ParseResult | null;
  error: string | null;
}

interface DiscoveredFile {
  path: string;
  mtime: number;
  size: number;
}

interface DiscoverFilesResult {
  files: DiscoveredFile[];
  unsupportedByExtension: Map<string, number>;
}

const WORKER_CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 1));
const WORKER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "parser-worker.js");
const USE_TSX_WORKER_LOADER = WORKER_SCRIPT.includes(`${sep}src${sep}`);

export interface IndexerOptions {
  embeddings?: EmbeddingRuntime | null;
}

export function shouldIgnore(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);
  return (
    BUILTIN_IGNORE_PATTERNS.some((pattern) => parts.includes(pattern)) ||
    parts.some((part) => part.startsWith(".qa-temp-")) ||
    parts.some((part) => /^\.git-worktree/.test(part))
  );
}

function loadIgnoreFile(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function loadGitignorePatterns(projectRoot: string): string[] {
  return loadIgnoreFile(resolve(projectRoot, ".gitignore"));
}

function loadCwignorePatterns(projectRoot: string): string[] {
  return loadIgnoreFile(resolve(projectRoot, ".cwignore"));
}

function matchesGitignorePattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const cleanPattern = pattern.replace(/\\/g, "/").replace(/^!/, "");
  if (!cleanPattern) return false;
  const isDirectoryPattern = cleanPattern.endsWith("/");
  const normalizedPattern = cleanPattern.replace(/\/$/, "");
  if (!normalizedPattern) return false;

  if (normalizedPattern.includes("/")) {
    const regex = gitignorePatternToRegex(normalizedPattern);
    if (regex.test(normalizedPath)) return true;
    return isDirectoryPattern && (
      normalizedPath === normalizedPattern ||
      normalizedPath.startsWith(`${normalizedPattern}/`)
    );
  }

  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts.includes(normalizedPattern)) return true;

  const regex = gitignorePatternToRegex(normalizedPattern);
  const fileName = parts[parts.length - 1] ?? "";
  if (isDirectoryPattern) return false;
  return regex.test(fileName);
}

function gitignorePatternToRegex(pattern: string): RegExp {
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regex}$|/${regex}$|^${regex}/|/${regex}/`);
}

function isIgnoredByGitignore(relativePath: string, gitignorePatterns: string[]): boolean {
  let ignored = false;
  for (const pattern of gitignorePatterns) {
    if (pattern.startsWith("!")) {
      if (matchesGitignorePattern(relativePath, pattern.slice(1))) {
        ignored = false;
      }
    } else if (matchesGitignorePattern(relativePath, pattern)) {
      ignored = true;
    }
  }
  return ignored;
}

const ALWAYS_IGNORE_PATTERNS = [
  /^\.env($|\..*)$/,
  /^\.env\.local$/,
  /^\.env\.production$/,
  /^\.env\.development$/,
  /credentials\.json$/,
  /secrets?\//,
  /\.pem$/,
  /\.key$/,
];

function isAlwaysIgnored(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const fileName = normalizedPath.split("/").pop() ?? "";
  return ALWAYS_IGNORE_PATTERNS.some((re) => re.test(fileName) || re.test(normalizedPath));
}

function toRelativeProjectPath(filePath: string, projectRoot: string): string | null {
  const resolvedPath = resolve(filePath);
  const resolvedRoot = resolve(projectRoot);
  if (!isPathWithinRoot(resolvedPath, resolvedRoot)) return null;
  if (resolvedPath === resolvedRoot) return "";
  const relative = resolvedPath.slice(`${resolvedRoot}${sep}`.length);
  return relative.replace(/\\/g, "/");
}

export function isSecurityExcludedPath(filePath: string, projectRoot: string): boolean {
  const relativePath = toRelativeProjectPath(filePath, projectRoot);
  return relativePath !== null && isAlwaysIgnored(relativePath);
}

export function isIgnoredForIndexing(filePath: string, projectRoot: string, extraIgnore?: string[]): boolean {
  const relativePath = toRelativeProjectPath(filePath, projectRoot);
  if (relativePath === null) return true;
  if (shouldIgnore(filePath)) return true;

  const gitignorePatterns = loadGitignorePatterns(projectRoot);
  if (gitignorePatterns.length > 0 && isIgnoredByGitignore(relativePath, gitignorePatterns)) return true;

  const cwignorePatterns = loadCwignorePatterns(projectRoot);
  if (cwignorePatterns.length > 0 && isIgnoredByGitignore(relativePath, cwignorePatterns)) return true;

  return !!(extraIgnore && extraIgnore.length > 0 && isIgnoredByGitignore(relativePath, extraIgnore));
}

function isGitWorktree(dirPath: string): boolean {
  const gitPath = resolve(dirPath, ".git");
  try {
    const stat = statSync(gitPath);
    if (!stat.isFile()) return false;
    const content = readFileSync(gitPath, "utf-8");
    return content.startsWith("gitdir:");
  } catch {
    return false;
  }
}

function summarizeUnsupportedFiles(unsupportedByExtension: Map<string, number>): string | null {
  if (unsupportedByExtension.size === 0) return null;

  const ranked = [...unsupportedByExtension.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((acc, [, count]) => acc + count, 0);
  const topBreakdown = ranked.slice(0, 5).map(([extension, count]) => `${extension} (${count})`).join(", ");
  const remainder = ranked.slice(5).reduce((acc, [, count]) => acc + count, 0);
  const remainderText = remainder > 0 ? `, other (${remainder})` : "";
  return `Skipped ${total} unsupported files: ${topBreakdown}${remainderText}`;
}

async function discoverFiles(
  projectRoot: string,
  extraIgnore?: string[],
  startDirectory?: string
): Promise<DiscoverFilesResult> {
  const files: DiscoveredFile[] = [];
  const unsupportedByExtension = new Map<string, number>();
  const gitignorePatterns = loadGitignorePatterns(projectRoot);
  const cwignorePatterns = loadCwignorePatterns(projectRoot);
  const resolvedRoot = resolve(projectRoot);
  const resolvedRootWithSep = `${resolvedRoot}${sep}`;
  const resolvedStart = resolve(startDirectory ?? projectRoot);

  if (!isPathWithinRoot(resolvedStart, projectRoot)) {
    return { files, unsupportedByExtension };
  }

  const pendingDirs = [resolvedStart];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    if (!currentDir) continue;

    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = resolve(currentDir, entry.name);
      const relativePath = fullPath.startsWith(resolvedRootWithSep)
        ? fullPath.slice(resolvedRootWithSep.length)
        : entry.name;

      if (entry.isSymbolicLink()) {
        try {
          const realPath = realpathSync(fullPath);
          if (!isPathWithinRoot(realPath, resolvedRoot)) {
            log.debug("skipping symlink outside project root", { path: fullPath, target: realPath });
          }
        } catch {
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (shouldIgnore(fullPath)) continue;
        if (extraIgnore && extraIgnore.length > 0 && isIgnoredByGitignore(relativePath, extraIgnore)) continue;
        if (isGitWorktree(fullPath)) continue;
        pendingDirs.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldIgnore(fullPath)) continue;
      if (isAlwaysIgnored(relativePath)) continue;
      if (gitignorePatterns.length > 0 && isIgnoredByGitignore(relativePath, gitignorePatterns)) continue;
      if (cwignorePatterns.length > 0 && isIgnoredByGitignore(relativePath, cwignorePatterns)) continue;
      if (extraIgnore && extraIgnore.length > 0 && isIgnoredByGitignore(relativePath, extraIgnore)) continue;
      const language = detectLanguage(fullPath);
      if (!language) {
        const extension = extname(entry.name).toLowerCase() || "<no-extension>";
        unsupportedByExtension.set(extension, (unsupportedByExtension.get(extension) ?? 0) + 1);
        continue;
      }

      try {
        const stat = statSync(fullPath);
        files.push({
          path: relativePath.replace(/\\/g, "/"),
          mtime: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
      }
    }
  }

  return { files, unsupportedByExtension };
}

function symKey(name: string, kind: string): string {
  return `${name}\0${kind}`;
}

function diffSymbols(existing: SymbolRecord[], parsed: ParsedSymbol[]): IndexDiff {
  const existingByKey = new Map<string, SymbolRecord[]>();
  for (const s of existing) {
    const k = symKey(s.name, s.kind);
    const bucket = existingByKey.get(k);
    if (bucket) bucket.push(s);
    else existingByKey.set(k, [s]);
  }

  const parsedByKey = new Map<string, ParsedSymbol[]>();
  for (const s of parsed) {
    const k = symKey(s.name, s.kind);
    const bucket = parsedByKey.get(k);
    if (bucket) bucket.push(s);
    else parsedByKey.set(k, [s]);
  }

  const existingByHash = new Map(existing.map((s) => [s.bodyHash, s]));

  const added: ParsedSymbol[] = [];
  const modified: Array<{ old: SymbolRecord; new: ParsedSymbol }> = [];
  const deleted: SymbolRecord[] = [];
  const renamed: Array<{ old: SymbolRecord; new: ParsedSymbol }> = [];
  const unchanged: SymbolRecord[] = [];

  const matchedExistingIds = new Set<number>();

  for (const parsedSym of parsed) {
    const key = symKey(parsedSym.name, parsedSym.kind);
    const candidates = existingByKey.get(key);

    if (!candidates || candidates.length === 0) {
      const hashMatch = existingByHash.get(parsedSym.bodyHash);
      const parsedHasHashMatchKey = hashMatch ? parsedByKey.has(symKey(hashMatch.name, hashMatch.kind)) : false;
      if (hashMatch && !parsedHasHashMatchKey) {
        renamed.push({ old: hashMatch, new: parsedSym });
        matchedExistingIds.add(hashMatch.id);
      } else {
        added.push(parsedSym);
      }
      continue;
    }

    const exactMatch = candidates.find((s) => s.bodyHash === parsedSym.bodyHash);
    if (exactMatch) {
      unchanged.push(exactMatch);
      matchedExistingIds.add(exactMatch.id);
      continue;
    }

    const existingSym = candidates.find((s) => !matchedExistingIds.has(s.id)) ?? candidates[0]!;
    modified.push({ old: existingSym, new: parsedSym });
    matchedExistingIds.add(existingSym.id);
  }

  const renamedOldIds = new Set(renamed.map((r) => r.old.id));

  for (const existingSym of existing) {
    if (!matchedExistingIds.has(existingSym.id) && !renamedOldIds.has(existingSym.id)) {
      deleted.push(existingSym);
    }
  }

  return { added, modified, deleted, renamed, unchanged };
}

interface ReExportEntry {
  source: string;
  exportAll: boolean;
  specifiers: Array<{
    exportedName: string;
    importedName: string;
  }>;
}

interface TargetCandidate {
  id: number;
  viaReexport: boolean;
}

function extractReExports(parseResult: ParseResult): ReExportEntry[] {
  const entries: ReExportEntry[] = [];
  for (const imp of parseResult.imports) {
    if (!imp.isReExport) continue;
    entries.push({
      source: imp.source,
      exportAll: imp.exportAll ?? false,
      specifiers: (imp.specifiers ?? imp.names.map((name) => ({ localName: name, importedName: name }))).map(
        (specifier) => ({
          exportedName: specifier.localName,
          importedName: specifier.importedName,
        })
      ),
    });
  }
  return entries;
}

function resolveEdges(
  db: Database.Database,
  fileId: number,
  filePath: string,
  projectRoot: string,
  parseResult: ReturnType<typeof parseFile>,
  symbolMap: Map<string, number>,
  tsconfigPaths?: TsconfigPaths | null,
  reExportsByFileId?: Map<number, ReExportEntry[]>
): void {
  const edges = edgeQueries(db);
  const symbols = symbolQueries(db);
  const files = fileQueries(db);
  const now = Date.now();
  const fileSymbols = symbols.getByFileId(fileId);
  if (fileSymbols.length === 0) return;
  const sourceIsFrameworkEntry = isFrameworkEntryPath(filePath);
  const callLikeSymbolKinds = new Set(["function", "method", "arrow", "class"]);

  for (const symbol of fileSymbols) {
    edges.deleteBySource(symbol.id);
  }

  const resolveCallerId = (callerName: string, line: number): number | undefined => {
    const enclosing = fileSymbols
      .filter(
        (symbol) =>
          callLikeSymbolKinds.has(symbol.kind) &&
          symbol.startLine <= line &&
          symbol.endLine >= line
      )
      .sort(
        (a, b) =>
          (a.endLine - a.startLine) - (b.endLine - b.startLine) ||
          a.startLine - b.startLine
      )[0];
    if (enclosing) return enclosing.id;
    return symbolMap.get(callerName);
  };

  const localTargetsByName = new Map<string, number[]>();
  for (const symbol of fileSymbols) {
    const bucket = localTargetsByName.get(symbol.name);
    if (bucket) bucket.push(symbol.id);
    else localTargetsByName.set(symbol.name, [symbol.id]);
  }

  const fileSymbolsById = new Map(fileSymbols.map((symbol) => [symbol.id, symbol]));
  const owningClassIdBySymbolId = new Map<number, number | null>();
  const getOwningClassId = (symbolId: number): number | null => {
    if (owningClassIdBySymbolId.has(symbolId)) {
      return owningClassIdBySymbolId.get(symbolId) ?? null;
    }

    const symbol = fileSymbolsById.get(symbolId);
    if (!symbol) {
      owningClassIdBySymbolId.set(symbolId, null);
      return null;
    }
    if (symbol.kind === "class") {
      owningClassIdBySymbolId.set(symbolId, symbol.id);
      return symbol.id;
    }

    const owner = fileSymbols
      .filter(
        (candidate) =>
          candidate.kind === "class" &&
          candidate.startLine <= symbol.startLine &&
          candidate.endLine >= symbol.endLine
      )
      .sort(
        (a, b) =>
          (a.endLine - a.startLine) - (b.endLine - b.startLine) ||
          a.startLine - b.startLine
      )[0] ?? null;

    owningClassIdBySymbolId.set(symbolId, owner?.id ?? null);
    return owner?.id ?? null;
  };

  const callerIdsByCallee = new Map<string, Set<number>>();
  for (const call of parseResult.calls) {
    const callerId = resolveCallerId(call.callerSymbol, call.line);
    if (!callerId) continue;
    const existing = callerIdsByCallee.get(call.calleeName);
    if (existing) {
      existing.add(callerId);
    } else {
      callerIdsByCallee.set(call.calleeName, new Set([callerId]));
    }
  }

  const importedTargetsByName = new Map<string, Set<number>>();
  const importedReExportTargetsByName = new Map<string, Set<number>>();
  const relativeImportCache = new Map<string, number[]>();
  const fileRecordCache = new Map<number, ReturnType<typeof files.getById>>();
  const fileSymbolsCache = new Map<number, ReturnType<typeof symbols.getByFileId>>();
  const reExportCache = reExportsByFileId ?? new Map<number, ReExportEntry[]>();
  const reExportResolutionCache = new Map<string, number[]>();

  const getFileRecord = (id: number) => {
    if (!fileRecordCache.has(id)) {
      fileRecordCache.set(id, files.getById(id));
    }
    return fileRecordCache.get(id);
  };

  const getFileSymbols = (id: number) => {
    if (!fileSymbolsCache.has(id)) {
      fileSymbolsCache.set(id, symbols.getByFileId(id));
    }
    return fileSymbolsCache.get(id) ?? [];
  };

  const addImportedTarget = (name: string, symbolId: number, viaReexport: boolean) => {
    const map = viaReexport ? importedReExportTargetsByName : importedTargetsByName;
    const bucket = map.get(name) ?? new Set<number>();
    bucket.add(symbolId);
    map.set(name, bucket);
  };

  const resolveImportFileIdsFrom = (importSource: string, fromPath: string): number[] => {
    const candidatePaths = new Set<string>();

    if (importSource.startsWith(".")) {
      const basePath = resolve(dirname(fromPath), importSource);
      candidatePaths.add(basePath);
      for (const ext of IMPORT_RESOLVE_EXTENSIONS) {
        candidatePaths.add(`${basePath}${ext}`);
        candidatePaths.add(join(basePath, `index${ext}`));
      }
    } else if (tsconfigPaths) {
      const resolvedBases = resolveAliasedImport(importSource, tsconfigPaths);
      for (const base of resolvedBases) {
        candidatePaths.add(base);
        for (const ext of IMPORT_RESOLVE_EXTENSIONS) {
          candidatePaths.add(`${base}${ext}`);
          candidatePaths.add(join(base, `index${ext}`));
        }
      }
    }

    const fileIds: number[] = [];
    for (const candidatePath of candidatePaths) {
      const relCandidate = relative(projectRoot, candidatePath).replace(/\\/g, "/");
      const candidateFile = files.getByPath(relCandidate);
      if (!candidateFile) continue;
      fileIds.push(candidateFile.id);
    }

    return fileIds;
  };

  const resolveImportFileIds = (importSource: string): number[] => {
    const cached = relativeImportCache.get(importSource);
    if (cached) return cached;
    const fileIds = resolveImportFileIdsFrom(importSource, filePath);
    relativeImportCache.set(importSource, fileIds);
    return fileIds;
  };

  const resolveSourceFileIds = (source: string, fromFilePath: string): number[] => {
    return resolveImportFileIdsFrom(source, fromFilePath);
  };

  const getReExportsForFile = (targetFileId: number): ReExportEntry[] => {
    const cached = reExportCache.get(targetFileId);
    if (cached) return cached;
    reExportCache.set(targetFileId, []);
    return [];
  };

  const resolveReExportTargets = (
    targetFileId: number,
    exportedName: string,
    visited = new Set<number>()
  ): number[] => {
    const cacheKey = `${targetFileId}:${exportedName}`;
    const cached = reExportResolutionCache.get(cacheKey);
    if (cached) return cached;
    if (visited.has(targetFileId)) return [];
    visited.add(targetFileId);

    const file = getFileRecord(targetFileId);
    if (!file) {
      reExportResolutionCache.set(cacheKey, []);
      return [];
    }

    const resolved = new Set<number>();
    const reExports = getReExportsForFile(targetFileId);

    for (const reExport of reExports) {
      const lookups = reExport.exportAll
        ? [exportedName]
        : reExport.specifiers
          .filter((specifier) => specifier.exportedName === exportedName)
          .map((specifier) => specifier.importedName);
      if (lookups.length === 0) continue;

      const sourceFileIds = resolveSourceFileIds(reExport.source, resolve(projectRoot, file.path));
      for (const sourceFileId of sourceFileIds) {
        const sourceFile = getFileRecord(sourceFileId);
        if (!sourceFile) continue;
        const sourceSymbols = getFileSymbols(sourceFileId);
        for (const lookupName of lookups) {
          for (const sourceSymbol of sourceSymbols) {
            if (sourceSymbol.name === lookupName) {
              resolved.add(sourceSymbol.id);
            }
          }
          for (const nestedId of resolveReExportTargets(sourceFileId, lookupName, new Set(visited))) {
            resolved.add(nestedId);
          }
        }
      }
    }

    const out = [...resolved];
    reExportResolutionCache.set(cacheKey, out);
    return out;
  };

  const importNamePairs = (imp: ParseResult["imports"][number]): Array<{ localName: string; lookupName: string }> => {
    const specifiers = imp.specifiers;
    if (specifiers && specifiers.length > 0) {
      return specifiers.map((specifier) => ({
        localName: specifier.localName,
        lookupName: specifier.importedName,
      }));
    }
    return imp.names.map((name) => ({
      localName: name,
      lookupName: name,
    }));
  };

  for (const imp of parseResult.imports) {
    if (imp.isReExport) continue;
    const importFileIds = resolveImportFileIds(imp.source);
    if (importFileIds.length === 0) continue;
    const pairs = importNamePairs(imp);

    for (const importFileId of importFileIds) {
      const targetSymbols = getFileSymbols(importFileId);
      for (const pair of pairs) {
        const matches = targetSymbols.filter((symbol) => symbol.name === pair.lookupName);
        if (matches.length > 0) {
          for (const match of matches) {
            addImportedTarget(pair.localName, match.id, false);
          }
          continue;
        }

        for (const targetId of resolveReExportTargets(importFileId, pair.lookupName)) {
          addImportedTarget(pair.localName, targetId, true);
        }

        if (imp.kind === "default" && pair.lookupName === "default") {
          for (const exportedSymbol of targetSymbols.filter((symbol) => symbol.isExported).slice(0, MAX_EDGE_TARGETS_PER_REFERENCE)) {
            addImportedTarget(pair.localName, exportedSymbol.id, false);
            addImportedTarget(exportedSymbol.name, exportedSymbol.id, false);
          }
        }
      }
    }
  }

  const globalFallbackCache = new Map<string, number[]>();
  const getGlobalFallbackTargets = (name: string): number[] => {
    const cached = globalFallbackCache.get(name);
    if (cached) return cached;

    const fallbackTargets = symbols
      .getByName(name)
      .filter((target) => target.fileId === fileId || target.isExported)
      .slice(0, MAX_GLOBAL_FALLBACK_TARGETS)
      .map((target) => target.id);
    globalFallbackCache.set(name, fallbackTargets);
    return fallbackTargets;
  };

  const pickTargets = (localName: string, lookupName?: string): TargetCandidate[] => {
    const combined = new Map<number, TargetCandidate>();
    const local = localTargetsByName.get(localName);
    if (local) {
      for (const id of local) combined.set(id, { id, viaReexport: false });
    }
    const imported = importedTargetsByName.get(localName);
    if (imported) {
      for (const id of imported) {
        if (!combined.has(id)) combined.set(id, { id, viaReexport: false });
      }
    }
    const importedViaReexport = importedReExportTargetsByName.get(localName);
    if (importedViaReexport) {
      for (const id of importedViaReexport) {
        const existing = combined.get(id);
        if (existing) {
          existing.viaReexport = true;
        } else {
          combined.set(id, { id, viaReexport: true });
        }
      }
    }
    if (combined.size === 0) {
      const fallbackName = lookupName ?? localName;
      for (const id of getGlobalFallbackTargets(fallbackName)) {
        combined.set(id, { id, viaReexport: false });
      }
    }
    return [...combined.values()].slice(0, MAX_EDGE_TARGETS_PER_REFERENCE);
  };

  const narrowToSameOwnerLocalTargets = (
    callerId: number,
    localName: string,
    targetCandidates: TargetCandidate[]
  ): TargetCandidate[] => {
    const localTargetIds = localTargetsByName.get(localName) ?? [];
    if (localTargetIds.length < 2) return targetCandidates;

    const callerOwnerId = getOwningClassId(callerId);
    if (!callerOwnerId) return targetCandidates;

    const localTargetIdSet = new Set(localTargetIds);
    const sameOwnerIds = new Set(
      localTargetIds.filter((targetId) => getOwningClassId(targetId) === callerOwnerId)
    );
    if (sameOwnerIds.size === 0) return targetCandidates;

    const narrowed = targetCandidates.filter(
      (candidate) => !localTargetIdSet.has(candidate.id) || sameOwnerIds.has(candidate.id)
    );
    return narrowed.length > 0 ? narrowed : targetCandidates;
  };

  const resolveCallWithQualification = (
    _calleeName: string,
    callerId: number,
    candidates: TargetCandidate[]
  ): TargetCandidate[] => {
    if (candidates.length <= 1) return candidates;

    const importedClassIds = new Set<number>();
    for (const [, ids] of importedTargetsByName) {
      for (const id of ids) importedClassIds.add(id);
    }

    const callerRecord = fileSymbolsById.get(callerId);
    const callerParentName = callerRecord?.qualifiedName?.split(".")[0];

    const preferredByQualified: TargetCandidate[] = [];
    for (const candidate of candidates) {
      const sym = symbols.getById(candidate.id);
      if (!sym) continue;
      if (sym.parentSymbolId !== null) {
        if (importedClassIds.has(sym.parentSymbolId)) {
          preferredByQualified.push(candidate);
          continue;
        }
        if (callerParentName && sym.qualifiedName?.startsWith(`${callerParentName}.`)) {
          preferredByQualified.push(candidate);
        }
      }
    }

    return preferredByQualified.length > 0 ? preferredByQualified : candidates;
  };

  // Build variable-to-type map from variable bindings for receiver-based resolution.
  const variableTypeMap = new Map<string, string>();
  for (const binding of (parseResult.variableBindings ?? [])) {
    variableTypeMap.set(binding.variableName, binding.typeName);
  }

  for (const imp of parseResult.imports) {
    if (imp.isReExport) continue;
    const pairs = importNamePairs(imp);
    for (const pair of pairs) {
      const targetCandidates = pickTargets(pair.localName, pair.lookupName);
      if (targetCandidates.length === 0) continue;

      const callSourceIds = [...(callerIdsByCallee.get(pair.localName) ?? new Set<number>())];
      const sourceIds = (
        callSourceIds.length > 0
          ? callSourceIds
          : [symbolMap.get(pair.localName) ?? fileSymbols[0]?.id].filter((id): id is number => id !== undefined)
      ).slice(0, MAX_IMPORT_EDGE_SOURCES);

      for (const sourceId of sourceIds) {
        for (const target of targetCandidates) {
          if (sourceId === target.id) continue;
          edges.insert({
            sourceSymbolId: sourceId,
            targetSymbolId: target.id,
            kind: "import",
            createdAt: now,
          });
          if (target.viaReexport) {
            edges.insert({
              sourceSymbolId: sourceId,
              targetSymbolId: target.id,
              kind: "reexport",
              createdAt: now,
            });
          }
          if (sourceIsFrameworkEntry) {
            edges.insert({
              sourceSymbolId: sourceId,
              targetSymbolId: target.id,
              kind: "framework_entry",
              createdAt: now,
            });
          }
        }
      }
    }
  }

  for (const frameworkCall of parseResult.frameworkCalls) {
    const callerId = resolveCallerId(frameworkCall.callerSymbol, frameworkCall.line);
    if (!callerId) continue;

    const targetIds = resolveFrameworkTargets(frameworkCall, {
      files,
      symbols,
      pickTargets,
    });
    const edgeKind = frameworkCall.framework === "express_route" ? "route-handler" : "framework_entry";
    for (const targetId of targetIds) {
      if (callerId === targetId) continue;
      edges.insert({
        sourceSymbolId: callerId,
        targetSymbolId: targetId,
        kind: edgeKind,
        createdAt: now,
      });
    }
  }

  for (const call of parseResult.calls) {
    const callerId = resolveCallerId(call.callerSymbol, call.line);
    if (!callerId) continue;

    const rawCandidates = narrowToSameOwnerLocalTargets(
      callerId,
      call.calleeName,
      pickTargets(call.calleeName)
    );

    let targetCandidates: TargetCandidate[];
    if (call.receiverName && rawCandidates.length > 1) {
      const receiverType = variableTypeMap.get(call.receiverName);
      if (receiverType) {
        const receiverClassSymbols = symbols.getByName(receiverType);
        const receiverClassIds = new Set(receiverClassSymbols.map((s) => s.id));
        const preferred = rawCandidates.filter((c) => {
          const sym = symbols.getById(c.id);
          return sym?.parentSymbolId !== null && receiverClassIds.has(sym!.parentSymbolId!);
        });
        targetCandidates = preferred.length > 0
          ? preferred
          : resolveCallWithQualification(call.calleeName, callerId, rawCandidates);
      } else {
        targetCandidates = resolveCallWithQualification(call.calleeName, callerId, rawCandidates);
      }
    } else {
      targetCandidates = resolveCallWithQualification(call.calleeName, callerId, rawCandidates);
    }

    const kind = call.edgeKind ?? "call";
    for (const target of targetCandidates) {
      if (callerId === target.id && kind !== "server-action") continue;
      edges.insert({
        sourceSymbolId: callerId,
        targetSymbolId: target.id,
        kind,
        createdAt: now,
      });
      if (sourceIsFrameworkEntry) {
        edges.insert({
          sourceSymbolId: callerId,
          targetSymbolId: target.id,
          kind: "framework_entry",
          createdAt: now,
        });
      }
    }
  }
}

function runParseWorkerBatch(filePaths: string[]): Promise<WorkerFileParseResult[]> {
  if (USE_TSX_WORKER_LOADER) {
    return Promise.resolve(
      filePaths.map((filePath) => {
        const language = detectLanguage(filePath);
        if (!language) {
          return {
            filePath,
            content: "",
            mtime: 0,
            hash: "",
            language: "unknown",
            parsedAt: Date.now(),
            parseResult: null,
            error: "Unsupported language",
          } satisfies WorkerFileParseResult;
        }

        try {
          const stat = statSync(filePath);
          const mtime = stat.mtimeMs;
          if (stat.size > MAX_FILE_SIZE) {
            return {
              filePath,
              content: "",
              mtime,
              hash: "",
              language,
              parsedAt: Date.now(),
              parseResult: null,
              error: `File ${filePath} exceeds ${MAX_FILE_SIZE} byte limit (${stat.size} bytes)`,
            } satisfies WorkerFileParseResult;
          }

          const content = readFileSync(filePath, "utf-8");
          const hash = hashFile(content);
          const parseResult = parseFile(filePath, content, language);
          return {
            filePath,
            content,
            mtime,
            hash,
            language,
            parsedAt: Date.now(),
            parseResult,
            error: null,
          } satisfies WorkerFileParseResult;
        } catch (err) {
          return {
            filePath,
            content: "",
            mtime: 0,
            hash: "",
            language,
            parsedAt: Date.now(),
            parseResult: null,
            error: err instanceof Error ? err.message : String(err),
          } satisfies WorkerFileParseResult;
        }
      })
    );
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(
      WORKER_SCRIPT,
      USE_TSX_WORKER_LOADER
        ? { workerData: { filePaths }, execArgv: ["--import", "tsx"] }
        : { workerData: { filePaths } }
    );
    let settled = false;

    worker.once("message", (message) => {
      settled = true;
      const parsed = (message as WorkerFileParseResult[]).map((result) => ({
        ...result,
        parsedAt: result.parsedAt ?? Date.now(),
      }));
      resolvePromise(parsed);
    });

    worker.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });

    worker.once("exit", (code) => {
      if (settled || code === 0) return;
      settled = true;
      rejectPromise(new Error(`Parser worker exited with code ${code}`));
    });
  });
}

function writeParseResult(
  db: Database.Database,
  filePath: string,
  projectRoot: string,
  hash: string,
  fileMtime: number,
  language: string,
  parsedAt: number,
  parseResult: ParseResult,
  preparedChunks: PreparedChunk[],
  shouldResolveEdges = true,
  tsconfigPaths?: TsconfigPaths | null
): { symbolCount: number; errors: string[]; diff: IndexDiff | null; fileId: number | null; chunkCount: number } {
  const files = fileQueries(db);
  const symbolsDb = symbolQueries(db);
  const edgesDb = edgeQueries(db);
  const chunksDb = chunkQueries(db);

  const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");
  const existingFile = files.getByPath(relativePath);
  const now = parsedAt;

  if (existingFile && existingFile.lastIndexed > parsedAt) {
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null, fileId: existingFile.id, chunkCount: 0 };
  }

  if (existingFile && existingFile.hash === hash) {
    files.updateMtime(existingFile.id, fileMtime);
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null, fileId: existingFile.id, chunkCount: 0 };
  }

  let fileId: number;
  let diff: IndexDiff | null = null;

  if (existingFile) {
    const existingSymbols = symbolsDb.getByFileId(existingFile.id);
    diff = diffSymbols(existingSymbols, parseResult.symbols);

    for (const sym of diff.deleted) {
      edgesDb.deleteBySymbol(sym.id);
      symbolsDb.deleteById(sym.id);
    }

    for (const { old: oldSym } of diff.modified) {
      edgesDb.deleteBySymbol(oldSym.id);
      symbolsDb.deleteById(oldSym.id);
    }

    for (const { old: oldSym } of diff.renamed) {
      edgesDb.deleteBySymbol(oldSym.id);
      symbolsDb.deleteById(oldSym.id);
    }

    files.update({
      ...existingFile,
      hash,
      lastIndexed: now,
      mtime: fileMtime,
      symbolCount: parseResult.symbols.length,
      error: parseResult.errors.length > 0 ? parseResult.errors.join("; ") : null,
    });
    fileId = existingFile.id;
  } else {
    fileId = files.insert({
      path: relativePath,
      hash,
      lastIndexed: now,
      mtime: fileMtime,
      language,
      symbolCount: parseResult.symbols.length,
      error: parseResult.errors.length > 0 ? parseResult.errors.join("; ") : null,
    });
  }

  const symbolMap = new Map<string, number>();
  const insertedIds = new Map<string, number>();
  const symbolsToInsert = diff
    ? [...diff.added, ...diff.modified.map((m) => m.new), ...diff.renamed.map((r) => r.new)]
    : parseResult.symbols;

  for (const sym of symbolsToInsert) {
    const qualifiedName = sym.parentName ? `${sym.parentName}.${sym.name}` : sym.name;
    const id = symbolsDb.insert({
      fileId,
      name: sym.name,
      kind: sym.kind,
      startLine: sym.startLine,
      endLine: sym.endLine,
      signature: sym.signature,
      bodyHash: sym.bodyHash,
      fullSource: sym.fullSource,
      isExported: sym.isExported,
      docComment: sym.docComment,
      centrality: 0,
      lastSeen: now,
      parentSymbolId: null,
      qualifiedName,
    });
    insertedIds.set(`${sym.name}:${sym.startLine}`, id);
    if (!symbolMap.has(sym.name)) {
      symbolMap.set(sym.name, id);
    }
  }

  // Second pass: set parent_symbol_id for methods using parentName from parser.
  const parentIdByName = new Map<string, number>();
  for (const sym of symbolsToInsert) {
    if (!sym.parentName) {
      const id = insertedIds.get(`${sym.name}:${sym.startLine}`);
      if (id !== undefined && !parentIdByName.has(sym.name)) {
        parentIdByName.set(sym.name, id);
      }
    }
  }
  // Also include unchanged symbols as potential parents.
  if (diff) {
    for (const sym of diff.unchanged) {
      if (!parentIdByName.has(sym.name)) parentIdByName.set(sym.name, sym.id);
    }
  }
  for (const sym of symbolsToInsert) {
    if (!sym.parentName) continue;
    const symId = insertedIds.get(`${sym.name}:${sym.startLine}`);
    const parentId = parentIdByName.get(sym.parentName) ?? symbolMap.get(sym.parentName);
    if (symId !== undefined && parentId !== undefined) {
      symbolsDb.updateQualification(symId, parentId, `${sym.parentName}.${sym.name}`);
    }
  }

  if (diff) {
    for (const sym of diff.unchanged) {
      symbolMap.set(sym.name, sym.id);
    }
  }

  if (shouldResolveEdges) {
    resolveEdges(db, fileId, filePath, projectRoot, parseResult, symbolMap, tsconfigPaths);
  }
  chunksDb.replaceForFile(fileId, preparedChunks, now);
  return {
    symbolCount: parseResult.symbols.length,
    errors: parseResult.errors,
    diff,
    fileId,
    chunkCount: preparedChunks.length,
  };
}

async function embedChunksForFiles(
  db: Database.Database,
  fileIds: number[],
  runtime: EmbeddingRuntime
): Promise<number> {
  const uniqueFileIds = [...new Set(fileIds)];
  if (uniqueFileIds.length === 0) return 0;

  const chunksDb = chunkQueries(db);
  const chunks = uniqueFileIds.flatMap((fileId) => chunksDb.getByFileId(fileId));
  if (chunks.length === 0) return 0;

  const embeddings = await runtime.embedder.embedBatch(chunks.map((chunk) => chunk.contextualizedText));
  if (embeddings.length !== chunks.length) {
    throw new Error(`Expected ${chunks.length} embeddings, received ${embeddings.length}`);
  }

  runtime.vectorStore.storeBatch(
    chunks.map((chunk, index) => ({
      chunkId: chunk.id,
      embedding: embeddings[index]!,
    }))
  );

  return chunks.length;
}

export async function indexProject(
  db: Database.Database,
  projectRoot: string,
  extraIgnore?: string[],
  options: IndexerOptions = {}
): Promise<{ filesIndexed: number; symbolsFound: number; errors: string[] }> {
  const allErrors: string[] = [];
  const tsconfigPaths = loadTsconfigPaths(projectRoot);

  log.info("starting parallel index", { projectRoot, workers: WORKER_CONCURRENCY });
  const discovery = await discoverFiles(projectRoot, extraIgnore);
  const discoveredFiles = discovery.files;
  const filePaths = discoveredFiles.map((entry) => entry.path);
  const unsupportedSummary = summarizeUnsupportedFiles(discovery.unsupportedByExtension);
  if (unsupportedSummary) {
    allErrors.push(unsupportedSummary);
  }
  log.info(`discovered ${filePaths.length} files`);

  const files = fileQueries(db);
  const existingLightRecords = files.getAllPathsAndMtimes();
  const existingByPath = new Map(existingLightRecords.map((record) => [record.path, record]));
  const discovered = new Set(filePaths);
  let prunedCount = 0;
  for (const existing of existingLightRecords) {
    if (discovered.has(existing.path)) continue;
    files.deleteById(existing.id);
    prunedCount++;
  }
  if (prunedCount > 0) {
    log.info(`pruned ${prunedCount} deleted files`);
  }

  const toProcess: string[] = [];
  let skippedCount = 0;

  for (const file of discoveredFiles) {
    if (file.size > MAX_FILE_SIZE) {
      allErrors.push(`File ${file.path} exceeds ${MAX_FILE_SIZE} byte limit (${file.size} bytes)`);
      continue;
    }

    const existing = existingByPath.get(file.path);
    if (existing && file.mtime === existing.mtime) {
      skippedCount++;
      continue;
    }
    toProcess.push(file.path);
  }

  log.info(`skipped ${skippedCount} unchanged files, processing ${toProcess.length}`);

  if (toProcess.length === 0) {
    const backfilledSummaries = backfillSummariesIfNeeded(db);
    const backfilledClusters = backfillClustersIfNeeded(db, projectRoot);
    const backfilledPatterns = backfillPatternsIfNeeded(db);
    const backfilledChunks = await backfillChunksIfNeeded(db, projectRoot);
    if (backfilledSummaries || backfilledClusters || backfilledPatterns || backfilledChunks) {
      log.info("backfilled derived data for existing files", {
        summaries: backfilledSummaries,
        clusters: backfilledClusters,
        patterns: backfilledPatterns,
        chunks: backfilledChunks,
      });
    }
    return { filesIndexed: filePaths.length, symbolsFound: 0, errors: allErrors };
  }

  const toProcessAbsolute = toProcess.map((relPath) => resolve(projectRoot, relPath));
  const workerCount = Math.min(WORKER_CONCURRENCY, toProcessAbsolute.length);
  const batchSize = Math.max(1, Math.ceil(toProcessAbsolute.length / workerCount));
  const batches: string[][] = [];
  for (let i = 0; i < toProcessAbsolute.length; i += batchSize) {
    batches.push(toProcessAbsolute.slice(i, i + batchSize));
  }

  const settledBatches = await Promise.allSettled(batches.map((batch) => runParseWorkerBatch(batch)));
  const workerResults: WorkerFileParseResult[][] = [];
  for (const batch of settledBatches) {
    if (batch.status === "fulfilled") {
      workerResults.push(batch.value);
      continue;
    }
    allErrors.push(`worker batch failed: ${batch.reason instanceof Error ? batch.reason.message : String(batch.reason)}`);
  }

  const chunkingResults = await Promise.all(
    workerResults.flatMap((batchResult) =>
      batchResult
        .filter((parsed) => !parsed.error && !!parsed.parseResult)
        .map(async (parsed) => ({
          filePath: parsed.filePath,
          preparedChunks: await buildEmbeddingChunks(parsed.filePath, parsed.content, {
            languageHint: parsed.language,
          }).catch((error) => {
            allErrors.push(
              `${parsed.filePath}: chunking failed: ${error instanceof Error ? error.message : String(error)}`
            );
            return [];
          }),
        }))
    )
  );
  const chunksByPath = new Map(chunkingResults.map((entry) => [entry.filePath, entry.preparedChunks]));

  let totalSymbols = 0;
  const changedFileIds: number[] = [];
  const pendingEdgeResolutions: Array<{ filePath: string; parseResult: ParseResult }> = [];
  const seenContentHashes = new Map<string, string>();
  const indexAll = db.transaction(() => {
    for (const batchResult of workerResults) {
      for (const parsed of batchResult) {
        if (parsed.error || !parsed.parseResult) {
          allErrors.push(`${parsed.filePath}: ${parsed.error ?? "parser returned no result"}`);
          continue;
        }

        const existingPath = seenContentHashes.get(parsed.hash);
        if (existingPath !== undefined && parsed.filePath.length > existingPath.length) {
          log.debug("skipping duplicate file content", { path: parsed.filePath, duplicateOf: existingPath });
          continue;
        }
        seenContentHashes.set(parsed.hash, parsed.filePath);

        const result = writeParseResult(
          db,
            parsed.filePath,
            projectRoot,
            parsed.hash,
            parsed.mtime,
            parsed.language,
            parsed.parsedAt,
            parsed.parseResult,
            chunksByPath.get(parsed.filePath) ?? [],
            false
          );
        totalSymbols += result.symbolCount;
        allErrors.push(...result.errors);
        if (result.fileId && result.chunkCount > 0) {
          changedFileIds.push(result.fileId);
        }
        pendingEdgeResolutions.push({
          filePath: parsed.filePath,
          parseResult: parsed.parseResult,
        });
      }
    }
  });

  indexAll();

  if (options.embeddings) {
    try {
      await embedChunksForFiles(db, changedFileIds, options.embeddings);
    } catch (error) {
      allErrors.push(`embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const reExportsByPath = new Map<string, ReExportEntry[]>();
  for (const pending of pendingEdgeResolutions) {
    const reExports = extractReExports(pending.parseResult);
    if (reExports.length > 0) {
      reExportsByPath.set(pending.filePath, reExports);
    }
  }

  const EDGE_CHUNK_SIZE = 500;
  const filesDb = fileQueries(db);
  const symbolsDb = symbolQueries(db);

  const reExportsByFileId = new Map<number, ReExportEntry[]>();
  const fileRecordByPath = new Map<string, ReturnType<typeof filesDb.getByPath>>();
  const getResolvedFileRecord = (filePath: string) => {
    if (!fileRecordByPath.has(filePath)) {
      const relPath = relative(projectRoot, filePath).replace(/\\/g, "/");
      fileRecordByPath.set(filePath, filesDb.getByPath(relPath));
    }
    return fileRecordByPath.get(filePath);
  };
  for (const [filePath, reExports] of reExportsByPath) {
    const fileRecord = getResolvedFileRecord(filePath);
    if (fileRecord) reExportsByFileId.set(fileRecord.id, reExports);
  }

  for (let i = 0; i < pendingEdgeResolutions.length; i += EDGE_CHUNK_SIZE) {
    const chunk = pendingEdgeResolutions.slice(i, i + EDGE_CHUNK_SIZE);
    const resolveChunk = db.transaction(() => {
      for (const pending of chunk) {
        const fileRecord = getResolvedFileRecord(pending.filePath);
        if (!fileRecord) continue;

        const symbolMap = new Map<string, number>();
        for (const symbol of symbolsDb.getByFileId(fileRecord.id)) {
          if (!symbolMap.has(symbol.name)) symbolMap.set(symbol.name, symbol.id);
        }

        resolveEdges(db, fileRecord.id, pending.filePath, projectRoot, pending.parseResult, symbolMap, tsconfigPaths, reExportsByFileId);
      }
    });
    resolveChunk();
  }

  for (let i = 0; i < pendingEdgeResolutions.length; i += EDGE_CHUNK_SIZE) {
    const chunk = pendingEdgeResolutions.slice(i, i + EDGE_CHUNK_SIZE);
    const upsertChunk = db.transaction(() => {
      for (const pending of chunk) {
        const fileRecord = getResolvedFileRecord(pending.filePath);
        if (!fileRecord) continue;
        upsertFileSummary(db, fileRecord.id);
      }
    });
    upsertChunk();
  }

  computeClusters(db, projectRoot);
  detectPatterns(db);

  const repoProfile = profileRepo(projectRoot);
  persistProfile(db, projectRoot, repoProfile);

  const conventionGraph = buildConventionGraph(db, projectRoot);
  persistConventions(db, conventionGraph);

  synthesizeEventEdges(db);

  log.info(`indexed ${toProcess.length} files, ${totalSymbols} symbols`);
  return { filesIndexed: filePaths.length, symbolsFound: totalSymbols, errors: allErrors };
}

export async function indexDirectory(
  db: Database.Database,
  directoryPath: string,
  projectRoot: string,
  extraIgnore?: string[],
  options: IndexerOptions = {}
): Promise<{ filesIndexed: number; symbolsFound: number; errors: string[] }> {
  const resolvedDirectory = resolve(directoryPath);
  if (!isPathWithinRoot(resolvedDirectory, projectRoot)) {
    return {
      filesIndexed: 0,
      symbolsFound: 0,
      errors: [`Directory "${directoryPath}" is outside project root`],
    };
  }

  const discovery = await discoverFiles(projectRoot, extraIgnore, resolvedDirectory);
  const inDirectory = discovery.files;

  let symbolsFound = 0;
  const errors: string[] = [];
  const unsupportedSummary = summarizeUnsupportedFiles(discovery.unsupportedByExtension);
  if (unsupportedSummary) {
    errors.push(unsupportedSummary);
  }

  const discoveredPaths = new Set(inDirectory.map((f) => f.path));
  const files = fileQueries(db);
  const relativeDir = relative(projectRoot, resolvedDirectory).replace(/\\/g, "/");
  const existingInDir = files.searchByPath(relativeDir, 100000);
  let prunedCount = 0;
  for (const existing of existingInDir) {
    if (!discoveredPaths.has(existing.path)) {
      files.deleteById(existing.id);
      prunedCount++;
    }
  }
  if (prunedCount > 0) {
    log.info(`pruned ${prunedCount} excluded/deleted files from directory`);
  }

  for (const file of inDirectory) {
    const result = await indexSingleFile(db, file.path, projectRoot, extraIgnore, options);
    symbolsFound += result.symbolCount;
    errors.push(...result.errors);
  }

  return {
    filesIndexed: inDirectory.length,
    symbolsFound,
    errors,
  };
}

export function isPathWithinRoot(filePath: string, projectRoot: string): boolean {
  const resolvedPath = resolve(filePath);
  const resolvedRoot = resolve(projectRoot) + sep;
  return resolvedPath.startsWith(resolvedRoot) || resolvedPath === resolve(projectRoot);
}

export async function indexSingleFile(
  db: Database.Database,
  filePath: string,
  projectRoot: string,
  extraIgnore?: string[],
  options: IndexerOptions = {}
): Promise<{ symbolCount: number; errors: string[]; diff: IndexDiff | null }> {
  const resolvedPath = resolve(projectRoot, filePath);

  if (!isPathWithinRoot(resolvedPath, projectRoot)) {
    return { symbolCount: 0, errors: [`Path "${filePath}" is outside project root`], diff: null };
  }

  try {
    const stat = lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) {
      const realPath = realpathSync(resolvedPath);
      if (!isPathWithinRoot(realPath, projectRoot)) {
        return { symbolCount: 0, errors: [`Symlink "${filePath}" points outside project root`], diff: null };
      }
    }
  } catch (err) {
    log.debug("symlink check failed, skipping file", {
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return { symbolCount: 0, errors: [`Failed to check symlink for "${filePath}"`], diff: null };
  }

  if (isSecurityExcludedPath(resolvedPath, projectRoot)) {
    return { symbolCount: 0, errors: [`File "${filePath}" matches security exclusion pattern`], diff: null };
  }

  if (isIgnoredForIndexing(resolvedPath, projectRoot, extraIgnore)) {
    return { symbolCount: 0, errors: [`File "${filePath}" is excluded by ignore rules`], diff: null };
  }

  const files = fileQueries(db);
  const language = detectLanguage(resolvedPath);
  if (!language) {
    const extension = extname(resolvedPath).toLowerCase() || "<no-extension>";
    return { symbolCount: 0, errors: [`Unsupported language for "${filePath}" (extension "${extension}")`], diff: null };
  }

  const relPath = relative(projectRoot, resolvedPath).replace(/\\/g, "/");
  const existingFile = files.getByPath(relPath);

  let fileMtime = 0;
  let fileSize = 0;
  try {
    const stat = statSync(resolvedPath);
    fileMtime = stat.mtimeMs;
    fileSize = stat.size;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { symbolCount: 0, errors: [`Failed to stat ${resolvedPath}: ${message}`], diff: null };
  }

  if (fileSize > MAX_FILE_SIZE) {
    return { symbolCount: 0, errors: [`File ${resolvedPath} exceeds ${MAX_FILE_SIZE} byte limit (${fileSize} bytes)`], diff: null };
  }

  if (existingFile && existingFile.mtime === fileMtime) {
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null };
  }

  let content: string;
  try {
    content = readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { symbolCount: 0, errors: [`Failed to read ${resolvedPath}: ${message}`], diff: null };
  }

  const hash = hashFile(content);
  const parseResult = parseFile(resolvedPath, content, language);
  const preparedChunks = await buildEmbeddingChunks(resolvedPath, content, {
    languageHint: language,
  }).catch((error) => {
    parseResult.errors.push(`chunking failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });
  const tsconfigPaths = loadTsconfigPaths(projectRoot);
  const result = writeParseResult(
    db,
    resolvedPath,
    projectRoot,
    hash,
    fileMtime,
    language,
    Date.now(),
    parseResult,
    preparedChunks,
    true,
    tsconfigPaths
  );

  if (options.embeddings && result.fileId && result.chunkCount > 0) {
    try {
      await embedChunksForFiles(db, [result.fileId], options.embeddings);
    } catch (error) {
      result.errors.push(`embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    symbolCount: result.symbolCount,
    errors: result.errors,
    diff: result.diff,
  };
}

export function removeFile(db: Database.Database, filePath: string, projectRoot: string): void {
  const relPath = relative(projectRoot, filePath).replace(/\\/g, "/");
  fileQueries(db).deleteByPath(relPath);
}
