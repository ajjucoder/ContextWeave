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

  private isBusyError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /SQLITE_BUSY/i.test(error.message);
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
    try {
      insertAll();
    } catch (error) {
      if (this.isBusyError(error)) {
        return;
      }
      throw error;
    }
  }

  getRecentFileIds(limit = 50): number[] {
    const rows = this.db.prepare(`
      SELECT file_id, MAX(returned_at) AS last_returned_at
      FROM session_context
      WHERE session_id = ? AND file_id IS NOT NULL
      GROUP BY file_id
      ORDER BY last_returned_at DESC
      LIMIT ?
    `).all(this.sessionId, limit) as Array<{ file_id: number }>;
    return rows.map((r) => r.file_id);
  }

  getRecentSymbolIds(limit = 100): number[] {
    const rows = this.db.prepare(`
      SELECT symbol_id, MAX(returned_at) AS last_returned_at
      FROM session_context
      WHERE session_id = ? AND symbol_id IS NOT NULL
      GROUP BY symbol_id
      ORDER BY last_returned_at DESC
      LIMIT ?
    `).all(this.sessionId, limit) as Array<{ symbol_id: number }>;
    return rows.map((r) => r.symbol_id);
  }

  getRecentQueries(limit = 10): string[] {
    const rows = this.db.prepare(`
      SELECT query, MAX(returned_at) AS last_returned_at
      FROM session_context
      WHERE session_id = ?
      GROUP BY query
      ORDER BY last_returned_at DESC
      LIMIT ?
    `).all(this.sessionId, limit) as Array<{ query: string }>;
    return rows.map((r) => r.query);
  }
}
