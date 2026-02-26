import { readFileSync, statSync, lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { glob } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import type { ParsedSymbol, SymbolRecord, IndexDiff, ParseResult } from "./types.js";
import { parseFile, detectLanguage } from "./parser.js";
import { hashFile } from "../utils/hash.js";
import { fileQueries } from "../db/queries/files.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("indexer");

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const IGNORE_PATTERNS = [
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
  "env",
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

const WORKER_CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 1));
const WORKER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "parser-worker.js");
const USE_TSX_WORKER_LOADER = WORKER_SCRIPT.includes(`${sep}src${sep}`);

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => filePath.includes(`/${pattern}/`) || filePath.includes(`\\${pattern}\\`));
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
  const negated = pattern.startsWith("!");
  const clean = negated ? pattern.slice(1) : pattern;
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const normalizedPattern = clean.replace(/\\/g, "/").replace(/\/$/, "");

  if (normalizedPattern.includes("/")) {
    const regex = gitignorePatternToRegex(normalizedPattern);
    return negated ? false : regex.test(normalizedPath);
  }

  const parts = normalizedPath.split("/");
  for (const part of parts) {
    if (part === normalizedPattern) return !negated;
  }

  const regex = gitignorePatternToRegex(normalizedPattern);
  const fileName = normalizedPath.split("/").pop() ?? "";
  return negated ? false : regex.test(fileName);
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

async function discoverFiles(projectRoot: string, extraIgnore?: string[]): Promise<string[]> {
  const files: string[] = [];
  const pattern = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,c,h,cpp,cc,cxx,hpp,hxx,hh,cs,rb,rake,sh,bash,php}";
  const gitignorePatterns = loadGitignorePatterns(projectRoot);
  const cwignorePatterns = loadCwignorePatterns(projectRoot);
  const resolvedRoot = resolve(projectRoot) + sep;

  for await (const entry of glob(pattern, { cwd: projectRoot })) {
    const fullPath = resolve(projectRoot, entry);
    if (shouldIgnore(fullPath)) continue;

    const relativePath = fullPath.startsWith(resolvedRoot) ? fullPath.slice(resolvedRoot.length) : entry;
    if (isAlwaysIgnored(relativePath)) continue;
    if (gitignorePatterns.length > 0 && isIgnoredByGitignore(relativePath, gitignorePatterns)) continue;
    if (cwignorePatterns.length > 0 && isIgnoredByGitignore(relativePath, cwignorePatterns)) continue;
    if (extraIgnore && extraIgnore.length > 0 && extraIgnore.some((p) => fullPath.includes(`/${p}/`) || fullPath.includes(`\\${p}\\`) || relativePath.startsWith(p))) continue;

    try {
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        const realPath = realpathSync(fullPath);
        if (!realPath.startsWith(resolvedRoot)) {
          log.debug("skipping symlink outside project root", { path: fullPath, target: realPath });
          continue;
        }
      }
    } catch {
      continue;
    }

    files.push(fullPath);
  }

  return files;
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

function resolveEdges(
  db: Database.Database,
  fileId: number,
  parseResult: ReturnType<typeof parseFile>,
  symbolMap: Map<string, number>
): void {
  const edges = edgeQueries(db);
  const symbols = symbolQueries(db);
  const now = Date.now();

  for (const imp of parseResult.imports) {
    for (const name of imp.names) {
      const targetSymbols = symbols.getByName(name);
      const sourceSymbols = symbols.getByFileId(fileId);

      for (const source of sourceSymbols) {
        for (const target of targetSymbols) {
          if (source.id === target.id) continue;
          edges.insert({
            sourceSymbolId: source.id,
            targetSymbolId: target.id,
            kind: "import",
            createdAt: now,
          });
        }
      }
    }
  }

  for (const call of parseResult.calls) {
    const callerId = symbolMap.get(call.callerSymbol);
    if (!callerId) continue;

    const targetSymbols = symbols.getByName(call.calleeName);
    for (const target of targetSymbols) {
      if (callerId === target.id) continue;
      edges.insert({
        sourceSymbolId: callerId,
        targetSymbolId: target.id,
        kind: "call",
        createdAt: now,
      });
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
            error: null,
          } satisfies WorkerFileParseResult;
        }

        try {
          const mtime = statSync(filePath).mtimeMs;
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
  parseResult: ParseResult
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

  resolveEdges(db, fileId, parseResult, symbolMap);
  return { symbolCount: parseResult.symbols.length, errors: parseResult.errors, diff };
}

export async function indexProject(db: Database.Database, projectRoot: string, extraIgnore?: string[]): Promise<{ filesIndexed: number; symbolsFound: number; errors: string[] }> {
  const allErrors: string[] = [];

  log.info("starting parallel index", { projectRoot, workers: WORKER_CONCURRENCY });
  const filePaths = await discoverFiles(projectRoot, extraIgnore);
  log.info(`discovered ${filePaths.length} files`);

  const files = fileQueries(db);
  const discovered = new Set(filePaths);
  let prunedCount = 0;
  for (const existing of files.getAll()) {
    if (discovered.has(existing.path)) continue;
    files.deleteById(existing.id);
    prunedCount++;
  }
  if (prunedCount > 0) {
    log.info(`pruned ${prunedCount} deleted files`);
  }

  const toProcess: string[] = [];
  let skippedCount = 0;

  for (const filePath of filePaths) {
    const existing = files.getByPath(filePath);
    if (existing) {
      try {
        const mtime = statSync(filePath).mtimeMs;
        if (mtime === existing.mtime) {
          skippedCount++;
          continue;
        }
      } catch {
      }
    }
    toProcess.push(filePath);
  }

  log.info(`skipped ${skippedCount} unchanged files, processing ${toProcess.length}`);

  if (toProcess.length === 0) {
    return { filesIndexed: filePaths.length, symbolsFound: 0, errors: [] };
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
  const indexAll = db.transaction(() => {
    for (const batchResult of workerResults) {
      for (const parsed of batchResult) {
        if (parsed.error || !parsed.parseResult) {
          if (parsed.error) allErrors.push(`${parsed.filePath}: ${parsed.error}`);
          continue;
        }

        const result = writeParseResult(
          db,
            parsed.filePath,
            parsed.hash,
            parsed.mtime,
            parsed.language,
            parsed.parsedAt,
            parsed.parseResult
          );
        totalSymbols += result.symbolCount;
        allErrors.push(...result.errors);
      }
    }
  });

  indexAll();

  log.info(`indexed ${toProcess.length} files, ${totalSymbols} symbols`);
  return { filesIndexed: filePaths.length, symbolsFound: totalSymbols, errors: allErrors };
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
  } catch {
  }

  if (isAlwaysIgnored(resolvedPath)) {
    return { symbolCount: 0, errors: [`File "${filePath}" matches security exclusion pattern`], diff: null };
  }

  const files = fileQueries(db);
  const language = detectLanguage(resolvedPath);
  if (!language) return { symbolCount: 0, errors: [], diff: null };

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
  return writeParseResult(db, resolvedPath, hash, fileMtime, language, Date.now(), parseResult);
}

export function removeFile(db: Database.Database, filePath: string): void {
  fileQueries(db).deleteByPath(filePath);
}
