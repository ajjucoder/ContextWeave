import type Database from "better-sqlite3";
import type { EdgeRecord, EdgeKind } from "../../core/types.js";
import { getEdgeStrength } from "../../core/edge-strength.js";

export interface EdgeRowStream {
  sourceSymbolId: number;
  targetSymbolId: number;
  kind: EdgeKind;
  createdAt: number;
}

export interface ConnectedSymbolRow {
  symbolId: number;
  fileId: number;
}

type EdgeQueriesResult = ReturnType<typeof edgeQueriesImpl>;
const edgeQueriesCache = new WeakMap<Database.Database, EdgeQueriesResult>();
const connectedSymbolsStmtCache = new WeakMap<
  Database.Database,
  Database.Statement<[number, number, number], ConnectedSymbolRow>
>();

export function edgeQueries(db: Database.Database): EdgeQueriesResult {
  const cached = edgeQueriesCache.get(db);
  if (cached) return cached;
  const result = edgeQueriesImpl(db);
  edgeQueriesCache.set(db, result);
  return result;
}

export function getConnectedSymbols(db: Database.Database, symbolId: number): ConnectedSymbolRow[] {
  let stmt = connectedSymbolsStmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare<[number, number, number], ConnectedSymbolRow>(`
      SELECT s.id as symbolId, s.file_id as fileId FROM edges e
      JOIN symbols s ON (
        CASE WHEN e.source_symbol_id = ? THEN e.target_symbol_id ELSE e.source_symbol_id END = s.id
      )
      WHERE (e.source_symbol_id = ? OR e.target_symbol_id = ?)
        AND e.kind IN ('call', 'implements', 'type_usage', 'inheritance')
      LIMIT 6
    `);
    connectedSymbolsStmtCache.set(db, stmt);
  }
  return stmt.all(symbolId, symbolId, symbolId);
}

function edgeQueriesImpl(db: Database.Database) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO edges (source_symbol_id, target_symbol_id, kind, strength, created_at)
    VALUES (@sourceSymbolId, @targetSymbolId, @kind, @strength, @createdAt)
  `);

  const getBySource = db.prepare("SELECT * FROM edges WHERE source_symbol_id = ?");
  const getByTarget = db.prepare("SELECT * FROM edges WHERE target_symbol_id = ?");
  const deleteBySymbol = db.prepare(
    "DELETE FROM edges WHERE source_symbol_id = ? OR target_symbol_id = ?"
  );
  const deleteBySource = db.prepare("DELETE FROM edges WHERE source_symbol_id = ?");
  const getAll = db.prepare("SELECT * FROM edges");
  const iterateAllStmt = db.prepare(
    "SELECT source_symbol_id, target_symbol_id, kind, created_at FROM edges"
  );
  const countAll = db.prepare("SELECT COUNT(*) as count FROM edges");

  function mapRow(row: unknown): EdgeRecord | undefined {
    if (!row) return undefined;
    const r = row as Record<string, unknown>;
    return {
      id: r["id"] as number,
      sourceSymbolId: r["source_symbol_id"] as number,
      targetSymbolId: r["target_symbol_id"] as number,
      kind: r["kind"] as EdgeKind,
      createdAt: r["created_at"] as number,
    };
  }

  function mapStreamRow(row: unknown): EdgeRowStream | undefined {
    if (!row) return undefined;
    const r = row as Record<string, unknown>;
    return {
      sourceSymbolId: r["source_symbol_id"] as number,
      targetSymbolId: r["target_symbol_id"] as number,
      kind: r["kind"] as EdgeKind,
      createdAt: r["created_at"] as number,
    };
  }

  return {
    insert(edge: Omit<EdgeRecord, "id">): void {
      insert.run({
        sourceSymbolId: edge.sourceSymbolId,
        targetSymbolId: edge.targetSymbolId,
        kind: edge.kind,
        strength: getEdgeStrength(edge.kind),
        createdAt: edge.createdAt,
      });
    },

    getBySource(symbolId: number): EdgeRecord[] {
      return getBySource.all(symbolId).map(mapRow).filter(Boolean) as EdgeRecord[];
    },

    getByTarget(symbolId: number): EdgeRecord[] {
      return getByTarget.all(symbolId).map(mapRow).filter(Boolean) as EdgeRecord[];
    },

    deleteBySymbol(symbolId: number): void {
      deleteBySymbol.run(symbolId, symbolId);
    },

    deleteBySource(symbolId: number): void {
      deleteBySource.run(symbolId);
    },

    getAll(): EdgeRecord[] {
      return getAll.all().map(mapRow).filter(Boolean) as EdgeRecord[];
    },

    *iterateAll(): IterableIterator<EdgeRowStream> {
      for (const row of iterateAllStmt.iterate()) {
        const mapped = mapStreamRow(row);
        if (mapped) yield mapped;
      }
    },

    count(): number {
      return (countAll.get() as { count: number }).count;
    },
  };
}
