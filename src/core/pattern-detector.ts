import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { fileQueries } from "../db/queries/files.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { edgeQueries } from "../db/queries/edges.js";
import type { CodePattern, PatternSignature, SymbolRecord } from "./types.js";

const PATTERN_QUERY = "SELECT id, name, description, files, signature, confidence FROM patterns ORDER BY confidence DESC, name ASC";
const patternStmtCache = new WeakMap<Database.Database, ReturnType<Database.Database["prepare"]>>();
function getPatternStmt(db: Database.Database) {
  const cached = patternStmtCache.get(db);
  if (cached) return cached;
  const stmt = db.prepare(PATTERN_QUERY);
  patternStmtCache.set(db, stmt);
  return stmt;
}

const norm = (v: string) => v.replaceAll("\\", "/");
const uniqSort = (values: Iterable<string>) => [...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b));
const dirPattern = (filePath: string) => {
  const parts = norm(filePath).split("/").filter(Boolean);
  return parts.length > 2 ? [...parts.slice(0, -2), "*", parts.at(-1)!].join("/") : norm(filePath);
};
const patternId = (signature: PatternSignature) => createHash("sha256").update(JSON.stringify(signature)).digest("hex");
const patternConfidence = (n: number) => (n >= 5 ? 0.9 : n === 4 ? 0.75 : 0.6);

function patternName(signature: PatternSignature, files: string[]): string {
  const fileName = files[0]?.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "file";
  const title = fileName.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  return /page$/i.test(fileName) ? `${title} Pattern` : `${title} Structure Pattern`;
}

function patternDescription(signature: PatternSignature): string {
  const parts = [`Files in ${signature.directoryPattern}`];
  if (signature.importShape.length) parts.push(`import ${signature.importShape.slice(0, 3).join(", ")}`);
  if (signature.exportShape.length) parts.push(`export ${signature.exportShape.join("/")}`);
  if (signature.hookUsage.length) parts.push(`use ${signature.hookUsage.join(", ")}`);
  return parts.join(", ");
}

function buildSignature(filePath: string, symbols: SymbolRecord[], outgoing: Map<number, string[]>): PatternSignature {
  const imports = new Set<string>();
  const exports = new Set<string>();
  const hooks = new Set<string>();
  const kinds = new Set<string>();
  for (const symbol of symbols) {
    kinds.add(symbol.kind);
    if (symbol.isExported) {
      exports.add(symbol.kind);
      if (/\bexport\s+default\b/i.test(symbol.signature)) exports.add("default");
    }
    if (/^use[A-Z]\w*/.test(symbol.name)) hooks.add(symbol.name);
    for (const target of outgoing.get(symbol.id) ?? []) {
      if (/^use[A-Z]\w*/.test(target)) hooks.add(target);
      if (target === "react" || target.startsWith("@") || target.includes("/")) imports.add(target);
    }
  }
  return {
    importShape: uniqSort(imports),
    exportShape: uniqSort(exports),
    hookUsage: uniqSort(hooks),
    symbolKinds: uniqSort(kinds),
    directoryPattern: dirPattern(filePath),
  };
}

function persistPatterns(db: Database.Database, patterns: CodePattern[]): void {
  db.exec("DELETE FROM patterns");
  if (patterns.length === 0) return;
  const insert = db.prepare("INSERT INTO patterns (id, name, description, files, signature, confidence, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const tx = db.transaction((rows: CodePattern[]) => {
    const detectedAt = Date.now();
    for (const pattern of rows) {
      insert.run(pattern.id, pattern.name, pattern.description, JSON.stringify(pattern.files), JSON.stringify(pattern.signature), pattern.confidence, detectedAt);
    }
  });
  tx(patterns);
}

export function detectPatterns(db: Database.Database): CodePattern[] {
  const files = fileQueries(db).getAll();
  const symbolsDb = symbolQueries(db);
  const names = new Map(symbolsDb.getAll().map((symbol) => [symbol.id, symbol.name]));
  const outgoing = new Map<number, string[]>();
  for (const edge of edgeQueries(db).iterateAll()) {
    const target = names.get(edge.targetSymbolId);
    if (!target) continue;
    const list = outgoing.get(edge.sourceSymbolId) ?? [];
    list.push(target);
    outgoing.set(edge.sourceSymbolId, list);
  }

  const grouped = new Map<string, { signature: PatternSignature; files: string[] }>();
  for (const file of files) {
    const fileSymbols = symbolsDb.getByFileId(file.id);
    if (fileSymbols.length === 0) continue;
    const signature = buildSignature(file.path, fileSymbols, outgoing);
    const id = patternId(signature);
    const group = grouped.get(id) ?? { signature, files: [] };
    group.files.push(norm(file.path));
    grouped.set(id, group);
  }

  const patterns = [...grouped.entries()]
    .filter(([, group]) => group.files.length >= 3)
    .map(([id, group]) => {
      const files = [...group.files].sort((a, b) => a.localeCompare(b));
      return {
        id,
        name: patternName(group.signature, files),
        description: patternDescription(group.signature),
        files,
        confidence: patternConfidence(files.length),
        signature: group.signature,
      } satisfies CodePattern;
    })
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));

  persistPatterns(db, patterns);
  return patterns;
}

export function getPatternsForFiles(db: Database.Database, filePaths: string[]): CodePattern[] {
  if (filePaths.length === 0) return [];
  const wanted = new Set(filePaths.map(norm));
  return (getPatternStmt(db).all() as Array<{ id: string; name: string; description: string; files: string; signature: string; confidence: number }>)
    .map((row) => ({ ...row, files: JSON.parse(row.files) as string[], signature: JSON.parse(row.signature) as PatternSignature }))
    .filter((row) => row.files.some((file) => wanted.has(norm(file))));
}

export function backfillPatternsIfNeeded(db: Database.Database): boolean {
  const fileCount = (db.prepare("SELECT COUNT(*) AS count FROM files").get() as { count: number }).count;
  if (fileCount === 0) return false;
  const patternCount = (db.prepare("SELECT COUNT(*) AS count FROM patterns").get() as { count: number }).count;
  if (patternCount > 0) return false;
  detectPatterns(db);
  return true;
}

