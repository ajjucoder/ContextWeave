import type Database from "better-sqlite3";
import type { SymbolRecord } from "../../core/types.js";

export function symbolQueries(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature, body_hash, full_source, is_exported, doc_comment, centrality, last_seen)
    VALUES (@fileId, @name, @kind, @startLine, @endLine, @signature, @bodyHash, @fullSource, @isExported, @docComment, @centrality, @lastSeen)
  `);

  const updateCentrality = db.prepare("UPDATE symbols SET centrality = @centrality WHERE id = @id");
  const getByFileId = db.prepare("SELECT * FROM symbols WHERE file_id = ?");
  const getById = db.prepare("SELECT * FROM symbols WHERE id = ?");
  const getByName = db.prepare("SELECT * FROM symbols WHERE name = ?");
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

  function mapRow(row: unknown): SymbolRecord | undefined {
    if (!row) return undefined;
    const r = row as Record<string, unknown>;
    return {
      id: r["id"] as number,
      fileId: r["file_id"] as number,
      name: r["name"] as string,
      kind: r["kind"] as SymbolRecord["kind"],
      startLine: r["start_line"] as number,
      endLine: r["end_line"] as number,
      signature: r["signature"] as string,
      bodyHash: r["body_hash"] as string,
      fullSource: r["full_source"] as string,
      isExported: (r["is_exported"] as number) === 1,
      docComment: r["doc_comment"] as string | null,
      centrality: r["centrality"] as number,
      lastSeen: r["last_seen"] as number,
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
      });
      return Number(result.lastInsertRowid);
    },

    updateCentrality(id: number, centrality: number): void {
      updateCentrality.run({ id, centrality });
    },

    getByFileId(fileId: number): SymbolRecord[] {
      return getByFileId.all(fileId).map(mapRow).filter(Boolean) as SymbolRecord[];
    },

    getById(id: number): SymbolRecord | undefined {
      return mapRow(getById.get(id));
    },

    getByName(name: string): SymbolRecord[] {
      return getByName.all(name).map(mapRow).filter(Boolean) as SymbolRecord[];
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
      const escaped = term.replace(/["*]/g, "");
      if (!escaped) return [];
      const pattern = `"${escaped}"`;
      return searchFTS.all(pattern, limit).map(mapRow).filter(Boolean) as SymbolRecord[];
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
  };
}
