import type Database from "better-sqlite3";
import type { EdgeRecord, EdgeKind } from "../../core/types.js";

export function edgeQueries(db: Database.Database) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO edges (source_symbol_id, target_symbol_id, kind, created_at)
    VALUES (@sourceSymbolId, @targetSymbolId, @kind, @createdAt)
  `);

  const getBySource = db.prepare("SELECT * FROM edges WHERE source_symbol_id = ?");
  const getByTarget = db.prepare("SELECT * FROM edges WHERE target_symbol_id = ?");
  const deleteBySymbol = db.prepare(
    "DELETE FROM edges WHERE source_symbol_id = ? OR target_symbol_id = ?"
  );
  const deleteBySource = db.prepare("DELETE FROM edges WHERE source_symbol_id = ?");
  const getAll = db.prepare("SELECT * FROM edges");
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

  return {
    insert(edge: Omit<EdgeRecord, "id">): void {
      insert.run({
        sourceSymbolId: edge.sourceSymbolId,
        targetSymbolId: edge.targetSymbolId,
        kind: edge.kind,
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

    count(): number {
      return (countAll.get() as { count: number }).count;
    },
  };
}
