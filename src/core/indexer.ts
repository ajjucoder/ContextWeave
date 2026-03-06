import { readFileSync, statSync, lstatSync, realpathSync, readdirSync } from "node:fs";
import type { Dirent } from "node:fs";
import { resolve, sep, dirname, join, extname } from "node:path";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { ParsedSymbol, SymbolRecord, IndexDiff, ParseResult } from "./types.js";
import { parseFile, detectLanguage } from "./parser.js";
import { hashFile } from "../utils/hash.js";
import { fileQueries } from "../db/queries/files.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { createLogger } from "../utils/logger.js";
import { isFrameworkEntryPath } from "../utils/path-retrieval.js";
import { upsertFileSummary, backfillSummariesIfNeeded } from "./file-summaries.js";
import { computeClusters, backfillClustersIfNeeded } from "./clusters.js";
import { loadTsconfigPaths, resolveAliasedImport, type TsconfigPaths } from "../utils/tsconfig-paths.js";
import { resolveFrameworkTargets } from "../frameworks/registry.js";

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
];

interface WorkerFileParseResult {
  filePath: string;
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

function shouldIgnore(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);
  return BUILTIN_IGNORE_PATTERNS.some((pattern) => parts.includes(pattern));
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
          path: fullPath,
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

  for (const symbol of fileSymbols) {
    edges.deleteBySource(symbol.id);
  }

  const localTargetsByName = new Map<string, number[]>();
  for (const symbol of fileSymbols) {
    const bucket = localTargetsByName.get(symbol.name);
    if (bucket) bucket.push(symbol.id);
    else localTargetsByName.set(symbol.name, [symbol.id]);
  }

  const callerIdsByCallee = new Map<string, Set<number>>();
  for (const call of parseResult.calls) {
    const callerId = symbolMap.get(call.callerSymbol);
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
      const candidateFile = files.getByPath(candidatePath);
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

      const sourceFileIds = resolveSourceFileIds(reExport.source, file.path);
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
    const callerId = symbolMap.get(frameworkCall.callerSymbol);
    if (!callerId) continue;

    const targetIds = resolveFrameworkTargets(frameworkCall, {
      files,
      symbols,
      pickTargets,
    });
    for (const targetId of targetIds) {
      if (callerId === targetId) continue;
      edges.insert({
        sourceSymbolId: callerId,
        targetSymbolId: targetId,
        kind: "framework_entry",
        createdAt: now,
      });
    }
  }

  for (const call of parseResult.calls) {
    const callerId = symbolMap.get(call.callerSymbol);
    if (!callerId) continue;

    const targetCandidates = pickTargets(call.calleeName);
    const kind = call.edgeKind ?? "call";
    for (const target of targetCandidates) {
      if (callerId === target.id) continue;
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
  hash: string,
  fileMtime: number,
  language: string,
  parsedAt: number,
  parseResult: ParseResult,
  shouldResolveEdges = true,
  tsconfigPaths?: TsconfigPaths | null
): { symbolCount: number; errors: string[]; diff: IndexDiff | null } {
  const files = fileQueries(db);
  const symbolsDb = symbolQueries(db);
  const edgesDb = edgeQueries(db);

  const existingFile = files.getByPath(filePath);
  const now = parsedAt;

  if (existingFile && existingFile.lastIndexed > parsedAt) {
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null };
  }

  if (existingFile && existingFile.hash === hash) {
    files.updateMtime(existingFile.id, fileMtime);
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null };
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
      path: filePath,
      hash,
      lastIndexed: now,
      mtime: fileMtime,
      language,
      symbolCount: parseResult.symbols.length,
      error: parseResult.errors.length > 0 ? parseResult.errors.join("; ") : null,
    });
  }

  const symbolMap = new Map<string, number>();
  const symbolsToInsert = diff
    ? [...diff.added, ...diff.modified.map((m) => m.new), ...diff.renamed.map((r) => r.new)]
    : parseResult.symbols;

  for (const sym of symbolsToInsert) {
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
    });
    if (!symbolMap.has(sym.name)) {
      symbolMap.set(sym.name, id);
    }
  }

  if (diff) {
    for (const sym of diff.unchanged) {
      symbolMap.set(sym.name, sym.id);
    }
  }

  if (shouldResolveEdges) {
    resolveEdges(db, fileId, filePath, parseResult, symbolMap, tsconfigPaths);
  }
  return { symbolCount: parseResult.symbols.length, errors: parseResult.errors, diff };
}

export async function indexProject(db: Database.Database, projectRoot: string, extraIgnore?: string[]): Promise<{ filesIndexed: number; symbolsFound: number; errors: string[] }> {
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
    if (backfilledSummaries || backfilledClusters) {
      log.info("backfilled derived data for existing files", { summaries: backfilledSummaries, clusters: backfilledClusters });
    }
    return { filesIndexed: filePaths.length, symbolsFound: 0, errors: allErrors };
  }

  const workerCount = Math.min(WORKER_CONCURRENCY, toProcess.length);
  const batchSize = Math.max(1, Math.ceil(toProcess.length / workerCount));
  const batches: string[][] = [];
  for (let i = 0; i < toProcess.length; i += batchSize) {
    batches.push(toProcess.slice(i, i + batchSize));
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

  let totalSymbols = 0;
  const pendingEdgeResolutions: Array<{ filePath: string; parseResult: ParseResult }> = [];
  const indexAll = db.transaction(() => {
    for (const batchResult of workerResults) {
      for (const parsed of batchResult) {
        if (parsed.error || !parsed.parseResult) {
          allErrors.push(`${parsed.filePath}: ${parsed.error ?? "parser returned no result"}`);
          continue;
        }

        const result = writeParseResult(
          db,
            parsed.filePath,
            parsed.hash,
            parsed.mtime,
            parsed.language,
            parsed.parsedAt,
            parsed.parseResult,
            false
          );
        totalSymbols += result.symbolCount;
        allErrors.push(...result.errors);
        pendingEdgeResolutions.push({
          filePath: parsed.filePath,
          parseResult: parsed.parseResult,
        });
      }
    }
  });

  indexAll();

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
  for (const [filePath, reExports] of reExportsByPath) {
    const fileRecord = filesDb.getByPath(filePath);
    if (fileRecord) reExportsByFileId.set(fileRecord.id, reExports);
  }

  for (let i = 0; i < pendingEdgeResolutions.length; i += EDGE_CHUNK_SIZE) {
    const chunk = pendingEdgeResolutions.slice(i, i + EDGE_CHUNK_SIZE);
    const resolveChunk = db.transaction(() => {
      for (const pending of chunk) {
        const fileRecord = filesDb.getByPath(pending.filePath);
        if (!fileRecord) continue;

        const symbolMap = new Map<string, number>();
        for (const symbol of symbolsDb.getByFileId(fileRecord.id)) {
          if (!symbolMap.has(symbol.name)) symbolMap.set(symbol.name, symbol.id);
        }

        resolveEdges(db, fileRecord.id, pending.filePath, pending.parseResult, symbolMap, tsconfigPaths, reExportsByFileId);
      }
    });
    resolveChunk();
  }

  for (let i = 0; i < pendingEdgeResolutions.length; i += EDGE_CHUNK_SIZE) {
    const chunk = pendingEdgeResolutions.slice(i, i + EDGE_CHUNK_SIZE);
    const upsertChunk = db.transaction(() => {
      for (const pending of chunk) {
        const fileRecord = filesDb.getByPath(pending.filePath);
        if (!fileRecord) continue;
        upsertFileSummary(db, fileRecord.id);
      }
    });
    upsertChunk();
  }

  computeClusters(db, projectRoot);

  log.info(`indexed ${toProcess.length} files, ${totalSymbols} symbols`);
  return { filesIndexed: filePaths.length, symbolsFound: totalSymbols, errors: allErrors };
}

export async function indexDirectory(
  db: Database.Database,
  directoryPath: string,
  projectRoot: string,
  extraIgnore?: string[]
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
  const existingInDir = files.searchByPath(resolvedDirectory, 100000);
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
    const result = indexSingleFile(db, file.path, projectRoot);
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

export function indexSingleFile(
  db: Database.Database,
  filePath: string,
  projectRoot: string
): { symbolCount: number; errors: string[]; diff: IndexDiff | null } {
  const resolvedPath = resolve(filePath);

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

  if (isAlwaysIgnored(resolvedPath)) {
    return { symbolCount: 0, errors: [`File "${filePath}" matches security exclusion pattern`], diff: null };
  }

  const files = fileQueries(db);
  const language = detectLanguage(resolvedPath);
  if (!language) {
    const extension = extname(resolvedPath).toLowerCase() || "<no-extension>";
    return { symbolCount: 0, errors: [`Unsupported language for "${filePath}" (extension "${extension}")`], diff: null };
  }

  const existingFile = files.getByPath(resolvedPath);

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
  const tsconfigPaths = loadTsconfigPaths(projectRoot);
  return writeParseResult(db, resolvedPath, hash, fileMtime, language, Date.now(), parseResult, true, tsconfigPaths);
}

export function removeFile(db: Database.Database, filePath: string): void {
  fileQueries(db).deleteByPath(filePath);
}
