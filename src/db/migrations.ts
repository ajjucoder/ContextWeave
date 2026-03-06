import type Database from "better-sqlite3";
import { createSchema } from "./schema.js";
import { createLogger } from "../utils/logger.js";
import { stem } from "../utils/stemmer.js";

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
  {
    version: 5,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_clusters (
          file_id    INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          cluster_id INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_file_clusters_cluster ON file_clusters(cluster_id);
      `);
    },
  },
  {
    version: 6,
    up(db) {
      const filesCols = db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
      if (!filesCols.some((c) => c.name === "basename")) {
        db.exec("ALTER TABLE files ADD COLUMN basename TEXT NOT NULL DEFAULT ''");
      }

      const rows = db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
      const updateBasename = db.prepare("UPDATE files SET basename = ? WHERE id = ?");
      for (const row of rows) {
        const normalized = row.path.replace(/\\/g, "/");
        const idx = normalized.lastIndexOf("/");
        const basename = idx >= 0 ? normalized.slice(idx + 1) : normalized;
        updateBasename.run(basename, row.id);
      }

      db.exec("CREATE INDEX IF NOT EXISTS idx_files_basename_path ON files(basename, path)");
    },
  },
  {
    version: 7,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bm25_doc_lengths (
          observation_id INTEGER PRIMARY KEY,
          dl INTEGER NOT NULL
        )
      `);

      const observations = db.prepare(
        "SELECT id, note, scope FROM observations"
      ).all() as Array<{ id: number; note: string; scope: string }>;

      if (observations.length === 0) return;

      const STOPWORDS = new Set([
        "the", "a", "an", "is", "it", "and", "or", "of", "to", "in",
        "for", "on", "at", "by", "with", "as", "this", "that", "from", "be",
      ]);

      function tokenize(text: string): string[] {
        return text
          .toLowerCase()
          .split(/[\s\W]+/)
          .filter((t) => t.length > 0 && !STOPWORDS.has(t))
          .map((t) => stem(t));
      }

      const deleteTerm = db.prepare("DELETE FROM bm25_index WHERE observation_id = ?");
      const deleteDocLen = db.prepare("DELETE FROM bm25_doc_lengths WHERE observation_id = ?");
      const insertTerm = db.prepare("INSERT OR REPLACE INTO bm25_index (term, observation_id, tf) VALUES (@term, @observationId, @tf)");
      const insertDocLen = db.prepare("INSERT OR REPLACE INTO bm25_doc_lengths (observation_id, dl) VALUES (?, ?)");
      const upsertStat = db.prepare("INSERT OR REPLACE INTO bm25_stats (key, value) VALUES (@key, @value)");

      let totalDl = 0;
      let docCount = 0;

      for (const obs of observations) {
        const text = obs.note + " " + obs.scope;
        const tokens = tokenize(text);
        if (tokens.length === 0) continue;

        deleteTerm.run(obs.id);
        deleteDocLen.run(obs.id);

        const tf = new Map<string, number>();
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

        for (const [term, count] of tf) {
          insertTerm.run({ term, observationId: obs.id, tf: count });
        }
        insertDocLen.run(obs.id, tokens.length);
        totalDl += tokens.length;
        docCount++;
      }

      upsertStat.run({ key: "doc_count", value: String(docCount) });
      upsertStat.run({ key: "avg_dl", value: String(docCount > 0 ? totalDl / docCount : 0) });
    },
  },
  {
    version: 8,
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
        CREATE INDEX IF NOT EXISTS idx_observations_scope ON observations(scope, archived);
      `);
    },
  },
  {
    version: 9,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session_context_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id  TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          symbol_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
          file_id     INTEGER REFERENCES files(id) ON DELETE CASCADE,
          query       TEXT    NOT NULL,
          relevance   REAL    NOT NULL DEFAULT 1.0,
          returned_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO session_context_new
          SELECT * FROM session_context
          WHERE session_id IN (SELECT id FROM sessions);
        DROP TABLE IF EXISTS session_context;
        ALTER TABLE session_context_new RENAME TO session_context;
        CREATE INDEX IF NOT EXISTS idx_session_ctx_session ON session_context(session_id);
        CREATE INDEX IF NOT EXISTS idx_session_ctx_symbol ON session_context(symbol_id);
      `);
    },
  },
  {
    version: 10,
    up(db) {
      db.exec("DELETE FROM file_summaries");
      db.exec("INSERT INTO file_summaries_fts(file_summaries_fts) VALUES ('rebuild')");
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
