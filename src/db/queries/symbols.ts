import type Database from "better-sqlite3";
import type { LightSymbolRecord, SymbolRecord } from "../../core/types.js";
import { sanitizeFTS5Term } from "../../utils/fts5-sanitize.js";
import { createLogger } from "../../utils/logger.js";
import { validateRow, type RowSchema } from "./row-validator.js";

type SymbolQueriesResult = ReturnType<typeof symbolQueriesImpl>;
const symbolQueriesCache = new WeakMap<Database.Database, SymbolQueriesResult>();
const logger = createLogger("symbols-query");

type RawSymbolRow = {
  id: number;
  file_id: number;
  name: string;
  kind: SymbolRecord["kind"];
  start_line: number;
  end_line: number;
  signature: string;
  body_hash: string;
  full_source: string;
  is_exported: number;
  doc_comment: string | null;
  centrality: number;
  last_seen: number;
  parent_symbol_id: number | null;
  qualified_name: string | null;
};

type RawLightSymbolRow = Omit<RawSymbolRow, "full_source" | "parent_symbol_id" | "qualified_name"> & {
  parent_symbol_id?: number | null;
  qualified_name?: string | null;
};

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const isNullableNumber = (value: unknown): value is number | null => value === null || typeof value === "number";
const isOptionalNullableString = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";
const isOptionalNullableNumber = (value: unknown): value is number | null | undefined =>
  value === undefined || value === null || typeof value === "number";
const isRowBoolean = (value: unknown): value is number => value === 0 || value === 1;

const symbolRowSchema: RowSchema<RawSymbolRow> = {
  id: (value): value is number => typeof value === "number",
  file_id: (value): value is number => typeof value === "number",
  name: (value): value is string => typeof value === "string",
  kind: (value): value is SymbolRecord["kind"] => typeof value === "string",
  start_line: (value): value is number => typeof value === "number",
  end_line: (value): value is number => typeof value === "number",
  signature: (value): value is string => typeof value === "string",
  body_hash: (value): value is string => typeof value === "string",
  full_source: (value): value is string => typeof value === "string",
  is_exported: isRowBoolean,
  doc_comment: isNullableString,
  centrality: (value): value is number => typeof value === "number",
  last_seen: (value): value is number => typeof value === "number",
  parent_symbol_id: isNullableNumber,
  qualified_name: isNullableString,
};

const lightSymbolRowSchema: RowSchema<RawLightSymbolRow> = {
  id: symbolRowSchema.id,
  file_id: symbolRowSchema.file_id,
  name: symbolRowSchema.name,
  kind: symbolRowSchema.kind,
  start_line: symbolRowSchema.start_line,
  end_line: symbolRowSchema.end_line,
  signature: symbolRowSchema.signature,
  body_hash: symbolRowSchema.body_hash,
  is_exported: symbolRowSchema.is_exported,
  doc_comment: symbolRowSchema.doc_comment,
  centrality: symbolRowSchema.centrality,
  last_seen: symbolRowSchema.last_seen,
  parent_symbol_id: isOptionalNullableNumber,
  qualified_name: isOptionalNullableString,
};

export function symbolQueries(db: Database.Database): SymbolQueriesResult {
  const cached = symbolQueriesCache.get(db);
  if (cached) return cached;
  const result = symbolQueriesImpl(db);
  symbolQueriesCache.set(db, result);
  return result;
}

function symbolQueriesImpl(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen, parent_symbol_id, qualified_name)
    VALUES (@fileId, @name, @kind, @startLine, @endLine, @signature, @bodyHash, @fullSource, @isExported, @docComment, @centrality, @lastSeen, @parentSymbolId, @qualifiedName)
  `);

  const updateCentrality = db.prepare("UPDATE symbols SET centrality = @centrality WHERE id = @id");
  const updateBetweenness = db.prepare("UPDATE symbols SET betweenness = @betweenness WHERE id = @id");
  const getByFileId = db.prepare("SELECT * FROM symbols WHERE file_id = ?");
  const getByFileIdLight = db.prepare(
    "SELECT id, file_id, name, kind, start_line, end_line, signature, body_hash, is_exported, doc_comment, centrality, last_seen FROM symbols WHERE file_id = ?"
  );
  const getByNameLight = db.prepare(
    "SELECT id, file_id, name, kind, start_line, end_line, signature, body_hash, is_exported, doc_comment, centrality, last_seen FROM symbols WHERE name = ?"
  );
  const getById = db.prepare("SELECT * FROM symbols WHERE id = ?");
  const getByIdLight = db.prepare(
    "SELECT id, file_id, name, kind, start_line, end_line, signature, body_hash, is_exported, doc_comment, centrality, last_seen FROM symbols WHERE id = ?"
  );
  const getByName = db.prepare("SELECT * FROM symbols WHERE name = ?");
  const getByNameCI = db.prepare("SELECT * FROM symbols WHERE name = ? COLLATE NOCASE");
  const getByFileAndName = db.prepare(
    "SELECT * FROM symbols WHERE file_id = ? AND name = ? ORDER BY centrality DESC LIMIT 1"
  );
  const getByNamePreferCentrality = db.prepare(
    "SELECT * FROM symbols WHERE name = ? ORDER BY centrality DESC LIMIT 1"
  );
  const getByBodyHash = db.prepare("SELECT * FROM symbols WHERE body_hash = ?");
  const deleteById = db.prepare("DELETE FROM symbols WHERE id = ?");
  const deleteByFileId = db.prepare("DELETE FROM symbols WHERE file_id = ?");
  const getAllNames = db.prepare("SELECT DISTINCT name FROM symbols");
  const searchFTS = db.prepare(`
    SELECT s.*
    FROM symbols_fts
    JOIN symbols s ON s.id = symbols_fts.rowid
    WHERE symbols_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);
  const countAll = db.prepare("SELECT COUNT(*) as count FROM symbols");
  const getAllIds = db.prepare("SELECT id FROM symbols");
  const getAll = db.prepare("SELECT * FROM symbols");
  const getExported = db.prepare("SELECT * FROM symbols WHERE is_exported = 1");
  const getEnclosingSymbolStmt = db.prepare(`
    SELECT * FROM symbols
    WHERE file_id = ? AND start_line <= ? AND end_line >= ?
    ORDER BY (end_line - start_line) ASC
    LIMIT 1
  `);
  const getByQualifiedNameStmt = db.prepare("SELECT * FROM symbols WHERE qualified_name = ?");
  const getByParentStmt = db.prepare("SELECT * FROM symbols WHERE parent_symbol_id = ?");
  const updateQualification = db.prepare(
    "UPDATE symbols SET parent_symbol_id = @parentSymbolId, qualified_name = @qualifiedName WHERE id = @id"
  );

  function mapRow(row: unknown): SymbolRecord | undefined {
    const r = validateRow(row, symbolRowSchema);
    if (!r) return undefined;
    return {
      id: r.id,
      fileId: r.file_id,
      name: r.name,
      kind: r.kind,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      bodyHash: r.body_hash,
      fullSource: r.full_source,
      isExported: r.is_exported === 1,
      docComment: r.doc_comment,
      centrality: r.centrality,
      lastSeen: r.last_seen,
      parentSymbolId: r.parent_symbol_id ?? null,
      qualifiedName: r.qualified_name ?? null,
    };
  }

  function mapRowLight(row: unknown): LightSymbolRecord | undefined {
    const r = validateRow(row, lightSymbolRowSchema);
    if (!r) return undefined;
    return {
      id: r.id,
      fileId: r.file_id,
      name: r.name,
      kind: r.kind,
      startLine: r.start_line,
      endLine: r.end_line,
      signature: r.signature,
      bodyHash: r.body_hash,
      isExported: r.is_exported === 1,
      docComment: r.doc_comment,
      centrality: r.centrality,
      lastSeen: r.last_seen,
      parentSymbolId: r.parent_symbol_id ?? null,
      qualifiedName: r.qualified_name ?? null,
    };
  }

  return {
    insert(symbol: Omit<SymbolRecord, "id">): number {
      const result = insert.run({
        fileId: symbol.fileId,
        name: symbol.name,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        signature: symbol.signature,
        bodyHash: symbol.bodyHash,
        fullSource: symbol.fullSource,
        isExported: symbol.isExported ? 1 : 0,
        docComment: symbol.docComment,
        centrality: symbol.centrality,
        lastSeen: symbol.lastSeen,
        parentSymbolId: symbol.parentSymbolId ?? null,
        qualifiedName: symbol.qualifiedName ?? null,
      });
      return Number(result.lastInsertRowid);
    },

    updateQualification(id: number, parentSymbolId: number | null, qualifiedName: string | null): void {
      updateQualification.run({ id, parentSymbolId, qualifiedName });
    },

    updateCentrality(id: number, centrality: number): void {
      updateCentrality.run({ id, centrality });
    },

    updateBetweenness(id: number, betweenness: number): void {
      updateBetweenness.run({ id, betweenness });
    },

    getByFileId(fileId: number): SymbolRecord[] {
      return getByFileId.all(fileId).map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    getByFileIdLight(fileId: number): LightSymbolRecord[] {
      return getByFileIdLight.all(fileId).map(mapRowLight).filter(Boolean) as LightSymbolRecord[];
    },

    getByNameLight(name: string): LightSymbolRecord[] {
      return getByNameLight.all(name).map(mapRowLight).filter(Boolean) as LightSymbolRecord[];
    },

    getById(id: number): SymbolRecord | undefined {
      return mapRow(getById.get(id));
    },

    getByIdLight(id: number): LightSymbolRecord | undefined {
      return mapRowLight(getByIdLight.get(id));
    },

    getByName(name: string): SymbolRecord[] {
      return getByName.all(name).map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    getByNameCI(name: string): SymbolRecord[] {
      return getByNameCI.all(name).map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    getByFileAndName(fileId: number, name: string): SymbolRecord | undefined {
      return mapRow(getByFileAndName.get(fileId, name));
    },

    getByNamePreferCentrality(name: string): SymbolRecord | undefined {
      return mapRow(getByNamePreferCentrality.get(name));
    },

    getByBodyHash(hash: string): SymbolRecord[] {
      return getByBodyHash.all(hash).map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    deleteById(id: number): void {
      deleteById.run(id);
    },

    deleteByFileId(fileId: number): void {
      deleteByFileId.run(fileId);
    },

    getAllNames(): string[] {
      return getAllNames.all().map((r) => (r as { name: string }).name);
    },

    searchFTS(term: string, limit: number): SymbolRecord[] {
      const sanitized = sanitizeFTS5Term(term);
      if (!sanitized) return [];
      const pattern = `"${sanitized}"`;
      try {
        return searchFTS.all(pattern, limit).map(mapRow).filter(Boolean) as SymbolRecord[];
      } catch (error) {
        logger.debug("FTS search failed", { error });
        return [];
      }
    },

    getAll(): SymbolRecord[] {
      return getAll.all().map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    getAllIds(): number[] {
      return getAllIds.all().map((r) => (r as { id: number }).id);
    },

    getExported(): SymbolRecord[] {
      return getExported.all().map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    count(): number {
      return (countAll.get() as { count: number }).count;
    },

    getEnclosingSymbol(fileId: number, line: number): SymbolRecord | null {
      return mapRow(getEnclosingSymbolStmt.get(fileId, line, line)) ?? null;
    },

    getByQualifiedName(qualifiedName: string): SymbolRecord[] {
      return getByQualifiedNameStmt.all(qualifiedName).map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    getByParent(parentSymbolId: number): SymbolRecord[] {
      return getByParentStmt.all(parentSymbolId).map(mapRow).filter(Boolean) as SymbolRecord[];
    },
  };
}

export function getEnclosingSymbol(
  db: Database.Database,
  fileId: number,
  line: number
): SymbolRecord | null {
  return symbolQueries(db).getEnclosingSymbol(fileId, line);
}
