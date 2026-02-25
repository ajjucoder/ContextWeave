import type Database from "better-sqlite3";

export function sessionQueries(db: Database.Database) {
  const ensureSessionStmt = db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, 'claude-code', ?, ?)"
  );

  return {
    ensureSession(id: string, projectRoot: string): void {
      ensureSessionStmt.run(id, projectRoot, Date.now());
    },
  };
}
