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
    INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count, error)
    VALUES (@path, @basename, @hash, @lastIndexed, @mtime, @language, @symbolCount, @error)
  `);

  const update = db.prepare(`
    UPDATE files
    SET basename = @basename, hash = @hash, last_indexed = @lastIndexed, mtime = @mtime, symbol_count = @symbolCount, error = @error
    WHERE id = @id
  `);

  const getByPath = db.prepare("SELECT * FROM files WHERE path = ?");
  const getById = db.prepare("SELECT * FROM files WHERE id = ?");
  const getAll = db.prepare("SELECT * FROM files ORDER BY path");
  const iterateAllStmt = db.prepare("SELECT * FROM files ORDER BY path");
  const getAllPathsAndMtimes = db.prepare("SELECT id, path, mtime, symbol_count FROM files");
  const searchByPath = db.prepare(
    "SELECT * FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY last_indexed DESC LIMIT ?"
  );
  const getByBasenameSuffix = db.prepare(`
    SELECT *
    FROM files
    WHERE basename = ?
      AND (path = ? OR path LIKE ? ESCAPE '\\')
    ORDER BY LENGTH(path) ASC
    LIMIT 1
  `);
  const getAllByBasenameSuffix = db.prepare(`
    SELECT *
    FROM files
    WHERE basename = ?
      AND (path = ? OR path LIKE ? ESCAPE '\\')
    ORDER BY LENGTH(path) ASC
  `);
  const deleteById = db.prepare("DELETE FROM files WHERE id = ?");
  const deleteByPath = db.prepare("DELETE FROM files WHERE path = ?");
  const countAll = db.prepare("SELECT COUNT(*) as count FROM files");
  const countStale = db.prepare("SELECT COUNT(*) as count FROM files WHERE mtime > last_indexed");
  const updateMtime = db.prepare("UPDATE files SET mtime = ? WHERE id = ?");

  function basenameForPath(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

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
        basename: basenameForPath(file.path),
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
        basename: basenameForPath(file.path),
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

    *iterateAll(): IterableIterator<FileRecord> {
      for (const row of iterateAllStmt.iterate()) {
        const mapped = mapRow(row);
        if (mapped) yield mapped;
      }
    },

    getAllPathsAndMtimes(): Array<{ id: number; path: string; mtime: number; symbolCount: number }> {
      return getAllPathsAndMtimes.all().map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r["id"] as number,
          path: r["path"] as string,
          mtime: r["mtime"] as number,
          symbolCount: r["symbol_count"] as number,
        };
      });
    },

    searchByPath(term: string, limit = 100): FileRecord[] {
      const escaped = term.replace(/[\\%_]/g, "\\$&");
      return searchByPath
        .all(`%${escaped}%`, limit)
        .map(mapRow)
        .filter(Boolean) as FileRecord[];
    },

    getByPathSuffix(suffix: string): FileRecord | undefined {
      const normalizedSuffix = suffix.replace(/\\/g, "/");
      const exact = getByPath.get(suffix) ?? getByPath.get(normalizedSuffix);
      if (exact) return mapRow(exact);

      const basename = basenameForPath(normalizedSuffix);
      if (!basename) return undefined;
      const escapedSuffix = normalizedSuffix.replace(/[\\%_]/g, "\\$&");
      return mapRow(getByBasenameSuffix.get(basename, normalizedSuffix, `%/${escapedSuffix}`));
    },

    getAllByPathSuffix(suffix: string): FileRecord[] {
      const normalizedSuffix = suffix.replace(/\\/g, "/");
      const exact = getByPath.get(suffix) ?? getByPath.get(normalizedSuffix);
      if (exact) {
        const record = mapRow(exact);
        return record ? [record] : [];
      }

      const basename = basenameForPath(normalizedSuffix);
      if (!basename) return [];
      const escapedSuffix = normalizedSuffix.replace(/[\\%_]/g, "\\$&");
      return getAllByBasenameSuffix
        .all(basename, normalizedSuffix, `%/${escapedSuffix}`)
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

    countStale(): number {
      return (countStale.get() as { count: number }).count;
    },
  };
}

export function countStaleFiles(db: Database.Database): number {
  return fileQueries(db).countStale();
}
