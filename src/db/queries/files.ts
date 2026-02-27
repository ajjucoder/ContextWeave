import type Database from "better-sqlite3";
import type { FileRecord } from "../../core/types.js";

export function fileQueries(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO files (path, hash, last_indexed, mtime, language, symbol_count, error)
    VALUES (@path, @hash, @lastIndexed, @mtime, @language, @symbolCount, @error)
  `);

  const update = db.prepare(`
    UPDATE files
    SET hash = @hash, last_indexed = @lastIndexed, mtime = @mtime, symbol_count = @symbolCount, error = @error
    WHERE id = @id
  `);

  const getByPath = db.prepare("SELECT * FROM files WHERE path = ?");
  const getById = db.prepare("SELECT * FROM files WHERE id = ?");
  const getAll = db.prepare("SELECT * FROM files ORDER BY path");
  const searchByPath = db.prepare(
    "SELECT * FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY last_indexed DESC LIMIT ?"
  );
  const deleteById = db.prepare("DELETE FROM files WHERE id = ?");
  const deleteByPath = db.prepare("DELETE FROM files WHERE path = ?");
  const countAll = db.prepare("SELECT COUNT(*) as count FROM files");
  const updateMtime = db.prepare("UPDATE files SET mtime = ? WHERE id = ?");

  function mapRow(row: unknown): FileRecord | undefined {
    if (!row) return undefined;
    const r = row as Record<string, unknown>;
    return {
      id: r["id"] as number,
      path: r["path"] as string,
      hash: r["hash"] as string,
      lastIndexed: r["last_indexed"] as number,
      mtime: (r["mtime"] as number) ?? 0,
      language: r["language"] as string,
      symbolCount: r["symbol_count"] as number,
      error: r["error"] as string | null,
    };
  }

  return {
    insert(file: Omit<FileRecord, "id">): number {
      const result = insert.run({
        path: file.path,
        hash: file.hash,
        lastIndexed: file.lastIndexed,
        mtime: file.mtime,
        language: file.language,
        symbolCount: file.symbolCount,
        error: file.error,
      });
      return Number(result.lastInsertRowid);
    },

    update(file: FileRecord): void {
      update.run({
        id: file.id,
        hash: file.hash,
        lastIndexed: file.lastIndexed,
        mtime: file.mtime,
        symbolCount: file.symbolCount,
        error: file.error,
      });
    },

    updateMtime(id: number, mtime: number): void {
      updateMtime.run(mtime, id);
    },

    getByPath(path: string): FileRecord | undefined {
      return mapRow(getByPath.get(path));
    },

    getById(id: number): FileRecord | undefined {
      return mapRow(getById.get(id));
    },

    getAll(): FileRecord[] {
      return getAll.all().map(mapRow).filter(Boolean) as FileRecord[];
    },

    searchByPath(term: string, limit = 100): FileRecord[] {
      const escaped = term.replace(/[\\%_]/g, "\\$&");
      return searchByPath
        .all(`%${escaped}%`, limit)
        .map(mapRow)
        .filter(Boolean) as FileRecord[];
    },

    deleteById(id: number): void {
      deleteById.run(id);
    },

    deleteByPath(path: string): void {
      deleteByPath.run(path);
    },

    count(): number {
      return (countAll.get() as { count: number }).count;
    },
  };
}
