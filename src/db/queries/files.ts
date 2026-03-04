import type Database from "better-sqlite3";
import type { FileRecord } from "../../core/types.js";

type FileQueriesResult = ReturnType<typeof fileQueriesImpl>;
const fileQueriesCache = new WeakMap<Database.Database, FileQueriesResult>();

export function fileQueries(db: Database.Database): FileQueriesResult {
  const cached = fileQueriesCache.get(db);
  if (cached) return cached;
  const result = fileQueriesImpl(db);
  fileQueriesCache.set(db, result);
  return result;
}

function fileQueriesImpl(db: Database.Database) {
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
  const getAllPaths = db.prepare("SELECT id, path FROM files");
  const deleteById = db.prepare("DELETE FROM files WHERE id = ?");
  const deleteByPath = db.prepare("DELETE FROM files WHERE path = ?");
  const countAll = db.prepare("SELECT COUNT(*) as count FROM files");
  const countStale = db.prepare("SELECT COUNT(*) as count FROM files WHERE mtime > last_indexed");
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

    getByPathSuffix(suffix: string): FileRecord | undefined {
      const exact = getByPath.get(suffix);
      if (exact) return mapRow(exact);

      const tail = `/${suffix}`;
      const rows = getAllPaths.all() as { id: number; path: string }[];
      let best: { id: number; path: string } | undefined;
      for (const row of rows) {
        if (row.path.endsWith(tail)) {
          if (!best || row.path.length < best.path.length) {
            best = row;
          }
        }
      }
      if (!best) return undefined;
      return mapRow(getById.get(best.id));
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

    countStale(): number {
      return (countStale.get() as { count: number }).count;
    },
  };
}

export function countStaleFiles(db: Database.Database): number {
  return fileQueries(db).countStale();
}
