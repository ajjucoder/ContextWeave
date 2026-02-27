import type Database from "better-sqlite3";

export interface SessionContextEntry {
  symbolId: number;
  fileId: number;
  query: string;
  relevance: number;
  returnedAt: number;
}

export class SessionContext {
  private db: Database.Database;
  private sessionId: string;

  constructor(db: Database.Database, sessionId: string) {
    this.db = db;
    this.sessionId = sessionId;
  }

  record(symbols: Array<{ symbolId: number; fileId: number }>, query: string): void {
    const insert = this.db.prepare(`
      INSERT INTO session_context (session_id, symbol_id, file_id, query, relevance, returned_at)
      VALUES (?, ?, ?, ?, 1.0, ?)
    `);
    const now = Date.now();
    const insertAll = this.db.transaction(() => {
      if (symbols.length === 0) {
        insert.run(this.sessionId, null, null, query, now);
        return;
      }
      for (const s of symbols) {
        insert.run(this.sessionId, s.symbolId, s.fileId, query, now);
      }
    });
    insertAll();
  }

  getRecentFileIds(limit = 50): number[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT file_id FROM session_context
      WHERE session_id = ? AND file_id IS NOT NULL ORDER BY returned_at DESC LIMIT ?
    `).all(this.sessionId, limit) as Array<{ file_id: number }>;
    return rows.map((r) => r.file_id);
  }

  getRecentSymbolIds(limit = 100): number[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT symbol_id FROM session_context
      WHERE session_id = ? ORDER BY returned_at DESC LIMIT ?
    `).all(this.sessionId, limit) as Array<{ symbol_id: number }>;
    return rows.map((r) => r.symbol_id);
  }

  getRecentQueries(limit = 10): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT query FROM session_context
      WHERE session_id = ? ORDER BY returned_at DESC LIMIT ?
    `).all(this.sessionId, limit) as Array<{ query: string }>;
    return rows.map((r) => r.query);
  }
}
