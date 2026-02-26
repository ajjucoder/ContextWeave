import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { glob } from "node:fs/promises";
import type Database from "better-sqlite3";
import type { ParsedSymbol, SymbolRecord, IndexDiff } from "./types.js";
import { parseFile, detectLanguage } from "./parser.js";
import { hashFile } from "../utils/hash.js";
import { fileQueries } from "../db/queries/files.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("indexer");

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

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => filePath.includes(`/${pattern}/`) || filePath.includes(`\\${pattern}\\`));
}

async function discoverFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  const pattern = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,c,h,cpp,cc,cxx,hpp,hxx,hh,cs,rb,rake,sh,bash,php}";

  for await (const entry of glob(pattern, { cwd: projectRoot })) {
    const fullPath = resolve(projectRoot, entry);
    if (shouldIgnore(fullPath)) continue;
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

export async function indexProject(db: Database.Database, projectRoot: string): Promise<{ filesIndexed: number; symbolsFound: number; errors: string[] }> {
  const allErrors: string[] = [];

  log.info("starting full index", { projectRoot });
  const filePaths = await discoverFiles(projectRoot);
  log.info(`discovered ${filePaths.length} files`);

  let totalSymbols = 0;

  const indexAll = db.transaction(() => {
    for (const filePath of filePaths) {
      const result = indexSingleFile(db, filePath, projectRoot);
      totalSymbols += result.symbolCount;
      allErrors.push(...result.errors);
    }
  });

  indexAll();

  log.info(`indexed ${filePaths.length} files, ${totalSymbols} symbols`);
  return { filesIndexed: filePaths.length, symbolsFound: totalSymbols, errors: allErrors };
}

export function indexSingleFile(
  db: Database.Database,
  filePath: string,
  _projectRoot: string
): { symbolCount: number; errors: string[]; diff: IndexDiff | null } {
  const files = fileQueries(db);
  const symbolsDb = symbolQueries(db);
  const edgesDb = edgeQueries(db);

  const language = detectLanguage(filePath);
  if (!language) return { symbolCount: 0, errors: [], diff: null };

  const existingFile = files.getByPath(filePath);
  const now = Date.now();

  let fileMtime = 0;
  try {
    fileMtime = statSync(filePath).mtimeMs;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { symbolCount: 0, errors: [`Failed to stat ${filePath}: ${message}`], diff: null };
  }

  if (existingFile && existingFile.mtime === fileMtime) {
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null };
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { symbolCount: 0, errors: [`Failed to read ${filePath}: ${message}`], diff: null };
  }

  const hash = hashFile(content);

  if (existingFile && existingFile.hash === hash) {
    files.updateMtime(existingFile.id, fileMtime);
    return { symbolCount: existingFile.symbolCount, errors: [], diff: null };
  }

  const parseResult = parseFile(filePath, content, language);

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
    symbolMap.set(sym.name, id);
  }

  if (diff) {
    for (const sym of diff.unchanged) {
      symbolMap.set(sym.name, sym.id);
    }
  }

  resolveEdges(db, fileId, parseResult, symbolMap);

  return { symbolCount: parseResult.symbols.length, errors: parseResult.errors, diff };
}

export function removeFile(db: Database.Database, filePath: string): void {
  fileQueries(db).deleteByPath(filePath);
}
