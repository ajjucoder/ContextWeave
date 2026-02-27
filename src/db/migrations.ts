import type Database from "better-sqlite3";
import { createSchema } from "./schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("migrations");

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      createSchema(db);
    },
  },
  {
    version: 2,
    up: (db) => {
      const filesCols = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
      if (!filesCols.some((c) => c.name === "mtime")) {
        db.exec("ALTER TABLE files ADD COLUMN mtime INTEGER NOT NULL DEFAULT 0");
      }

      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
          name,
          kind,
          content='symbols',
          content_rowid='id',
          tokenize='trigram'
        )
      `);

      db.exec("INSERT INTO symbols_fts(rowid, name, kind) SELECT id, name, kind FROM symbols");

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
          INSERT INTO symbols_fts(rowid, name, kind) VALUES (new.id, new.name, new.kind);
        END
      `);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
          INSERT INTO symbols_fts(symbols_fts, rowid, name, kind)
          VALUES ('delete', old.id, old.name, old.kind);
        END
      `);
      db.exec("DROP TRIGGER IF EXISTS symbols_au");
      db.exec(`
        CREATE TRIGGER symbols_au AFTER UPDATE OF name, kind ON symbols BEGIN
          INSERT INTO symbols_fts(symbols_fts, rowid, name, kind)
          VALUES ('delete', old.id, old.name, old.kind);
          INSERT INTO symbols_fts(rowid, name, kind) VALUES (new.id, new.name, new.kind);
        END
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_symbols_name_cov
        ON symbols(name, id, file_id, kind, centrality, is_exported, start_line)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_edges_src_cov
        ON edges(source_symbol_id, target_symbol_id, kind)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_edges_tgt_cov
        ON edges(target_symbol_id, source_symbol_id, kind)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_path_cov
        ON files(path, id, hash, mtime, symbol_count, last_indexed)
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_context (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id  TEXT    NOT NULL,
          symbol_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
          file_id     INTEGER REFERENCES files(id) ON DELETE CASCADE,
          query       TEXT    NOT NULL,
          relevance   REAL    NOT NULL DEFAULT 1.0,
          returned_at INTEGER NOT NULL
        )
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_session_ctx_session
        ON session_context(session_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_session_ctx_symbol
        ON session_context(symbol_id)
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_summaries (
          file_id        INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          export_names   TEXT    NOT NULL DEFAULT '',
          symbol_count   INTEGER NOT NULL DEFAULT 0,
          edge_count     INTEGER NOT NULL DEFAULT 0,
          avg_centrality REAL    NOT NULL DEFAULT 0.0,
          summary_text   TEXT    NOT NULL DEFAULT '',
          computed_at    INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS file_summaries_fts USING fts5(
          summary_text,
          content='file_summaries',
          content_rowid='file_id',
          tokenize='trigram'
        )
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version)
  );

  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    log.debug("no pending migrations");
    return;
  }

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      log.info(`applying migration v${migration.version}`);
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now()
      );
    }
  });

  runAll();
  log.info(`applied ${pending.length} migration(s)`);
}
