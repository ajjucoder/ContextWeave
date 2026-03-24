import type Database from "better-sqlite3";
import { createSchema } from "./schema.js";
import { createLogger } from "../utils/logger.js";
import { stem } from "../utils/stemmer.js";

const log = createLogger("migrations");

export interface Migration {
  version: number;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
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
  {
    version: 11,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          chunk_index         INTEGER NOT NULL,
          start_line          INTEGER NOT NULL,
          end_line            INTEGER NOT NULL,
          start_byte          INTEGER NOT NULL,
          end_byte            INTEGER NOT NULL,
          text                TEXT    NOT NULL,
          contextualized_text TEXT    NOT NULL,
          scope_chain         TEXT    NOT NULL DEFAULT '[]',
          import_context      TEXT    NOT NULL DEFAULT '[]',
          sibling_context     TEXT    NOT NULL DEFAULT '[]',
          entity_context      TEXT    NOT NULL DEFAULT '[]',
          token_count         INTEGER NOT NULL DEFAULT 0,
          content_hash        TEXT    NOT NULL,
          created_at          INTEGER NOT NULL,
          UNIQUE(file_id, chunk_index)
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id, chunk_index);
        CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(content_hash);
      `);
    },
  },
  {
    version: 12,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chunk_embeddings (
          chunk_id    INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
          embedding   BLOB    NOT NULL,
          dimensions  INTEGER NOT NULL DEFAULT 384,
          updated_at  INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 13,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS patterns (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          files TEXT NOT NULL,
          signature TEXT NOT NULL,
          confidence REAL NOT NULL,
          detected_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_patterns_detected_at ON patterns(detected_at);
      `);
    },
  },
  {
    version: 14,
    up(db) {
      const columns = db.prepare("PRAGMA table_info(file_summaries)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "body_features")) {
        db.exec(`ALTER TABLE file_summaries ADD COLUMN body_features TEXT NOT NULL DEFAULT '';`);
      }
      db.exec(`
        DROP TABLE IF EXISTS file_summaries_fts;
        CREATE VIRTUAL TABLE file_summaries_fts USING fts5(
          summary_text,
          body_features,
          content='file_summaries',
          content_rowid='file_id',
          tokenize='trigram'
        );
        INSERT INTO file_summaries_fts(rowid, summary_text, body_features)
        SELECT file_id, summary_text, body_features FROM file_summaries;
      `);
    },
  },
  {
    version: 15,
    up(db) {
      const columns = db.prepare("PRAGMA table_info(observations)").all() as Array<{ name: string }>;
      if (!columns.some((c) => c.name === "hit_count")) {
        db.exec("ALTER TABLE observations ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0");
      }
      if (!columns.some((c) => c.name === "last_hit_at")) {
        db.exec("ALTER TABLE observations ADD COLUMN last_hit_at INTEGER");
      }
    },
  },
  {
    version: 16,
    up(db) {
      // Convert absolute file paths to project-relative paths for portability.
      // Idempotent: only transforms paths that are absolute (start with / or drive letter).
      const rows = db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
      if (rows.length === 0) return;

      const absoluteRows = rows.filter(
        (r) => r.path.startsWith("/") || /^[A-Z]:\\/.test(r.path)
      );
      if (absoluteRows.length === 0) return;

      // Determine prefix to strip: prefer project_root from sessions table,
      // fall back to longest common directory prefix among absolute paths.
      const session = db.prepare(
        "SELECT project_root FROM sessions ORDER BY started_at DESC LIMIT 1"
      ).get() as { project_root: string } | undefined;

      let prefix = "";
      if (session?.project_root) {
        prefix = session.project_root.replace(/\\/g, "/");
      } else {
        const absPaths = absoluteRows.map((r) => r.path.replace(/\\/g, "/"));
        prefix = absPaths[0]!;
        for (const p of absPaths.slice(1)) {
          while (prefix && !p.startsWith(prefix)) {
            const lastSlash = prefix.lastIndexOf("/");
            if (lastSlash <= 0) {
              prefix = "";
              break;
            }
            prefix = prefix.slice(0, lastSlash);
          }
        }
      }

      if (!prefix || prefix === "/") return;
      if (!prefix.endsWith("/")) prefix += "/";

      const updatePath = db.prepare(
        "UPDATE files SET path = ?, basename = ? WHERE id = ?"
      );
      for (const row of absoluteRows) {
        const normalized = row.path.replace(/\\/g, "/");
        if (!normalized.startsWith(prefix)) continue;
        const relativePath = normalized.slice(prefix.length);
        if (!relativePath) continue;
        const idx = relativePath.lastIndexOf("/");
        const basename = idx >= 0 ? relativePath.slice(idx + 1) : relativePath;
        updatePath.run(relativePath, basename, row.id);
      }
    },
    down(db) {
      const rows = db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
      const relativeRows = rows.filter(
        (row) => !row.path.startsWith("/") && !/^[A-Z]:[\\/]/i.test(row.path)
      );
      if (relativeRows.length === 0) return;

      const session = db.prepare(
        "SELECT project_root FROM sessions ORDER BY started_at DESC LIMIT 1"
      ).get() as { project_root: string } | undefined;

      const projectRoot = session?.project_root.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!projectRoot) {
        throw new Error("Cannot roll back migration v16 without a session project_root");
      }

      const updatePath = db.prepare("UPDATE files SET path = ?, basename = ? WHERE id = ?");
      for (const row of relativeRows) {
        const normalizedPath = row.path.replace(/\\/g, "/").replace(/^\/+/, "");
        const absolutePath = `${projectRoot}/${normalizedPath}`;
        const idx = absolutePath.lastIndexOf("/");
        const basename = idx >= 0 ? absolutePath.slice(idx + 1) : absolutePath;
        updatePath.run(absolutePath, basename, row.id);
      }
    },
  },
  {
    version: 17,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repo_profile (
          project_root TEXT PRIMARY KEY,
          profile_json TEXT NOT NULL,
          detected_at  INTEGER NOT NULL
        );
      `);
    },
    down(db) {
      db.exec("DROP TABLE IF EXISTS repo_profile");
    },
  },
  {
    version: 18,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conventions (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          layer      TEXT NOT NULL,
          source     TEXT NOT NULL,
          file_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS convention_edges (
          source_convention TEXT NOT NULL,
          target_convention TEXT NOT NULL,
          edge_count        INTEGER NOT NULL,
          PRIMARY KEY (source_convention, target_convention)
        );
      `);
    },
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS convention_edges;
        DROP TABLE IF EXISTS conventions;
      `);
    },
  },
  {
    version: 19,
    up(db) {
      const cols = db.prepare("PRAGMA table_info(symbols)").all() as Array<{ name: string }>;
      const names = new Set(cols.map((c) => c.name));
      if (!names.has("parent_symbol_id")) {
        db.exec("ALTER TABLE symbols ADD COLUMN parent_symbol_id INTEGER REFERENCES symbols(id)");
      }
      if (!names.has("qualified_name")) {
        db.exec("ALTER TABLE symbols ADD COLUMN qualified_name TEXT");
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols (qualified_name);
        CREATE INDEX IF NOT EXISTS idx_symbols_parent_symbol_id ON symbols (parent_symbol_id);
      `);
    },
    down(db) {
      const columns = db.prepare("PRAGMA table_info(symbols)").all() as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));

      db.exec(`
        DROP INDEX IF EXISTS idx_symbols_qualified_name;
        DROP INDEX IF EXISTS idx_symbols_parent_symbol_id;
      `);

      if (names.has("qualified_name")) {
        db.exec("ALTER TABLE symbols DROP COLUMN qualified_name");
      }
      if (names.has("parent_symbol_id")) {
        db.exec("ALTER TABLE symbols DROP COLUMN parent_symbol_id");
      }
    },
  },
];

function ensureSchemaMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

export function runMigrations(db: Database.Database): void {
  ensureSchemaMigrationsTable(db);

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

export function rollbackMigration(db: Database.Database, targetVersion: number): void {
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`Invalid rollback target version: ${targetVersion}`);
  }

  ensureSchemaMigrationsTable(db);

  const appliedVersions = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version)
  );

  const rollbackPlan = migrations
    .filter((migration) => appliedVersions.has(migration.version) && migration.version > targetVersion)
    .sort((a, b) => b.version - a.version);

  if (rollbackPlan.length === 0) {
    log.debug(`no migrations to roll back for target v${targetVersion}`);
    return;
  }

  const missingDown = rollbackPlan.find((migration) => typeof migration.down !== "function");
  if (missingDown) {
    throw new Error(`Cannot roll back migration v${missingDown.version}: down() not implemented`);
  }

  const rollbackAll = db.transaction(() => {
    for (const migration of rollbackPlan) {
      log.info(`rolling back migration v${migration.version}`);
      migration.down!(db);
      db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(migration.version);
    }
  });

  rollbackAll();
  log.info(`rolled back ${rollbackPlan.length} migration(s) to v${targetVersion}`);
}
