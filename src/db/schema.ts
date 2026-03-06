import type Database from "better-sqlite3";

const TABLES = `
CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  path         TEXT    NOT NULL UNIQUE,
  basename     TEXT    NOT NULL DEFAULT '',
  hash         TEXT    NOT NULL,
  last_indexed INTEGER NOT NULL,
  mtime        INTEGER NOT NULL DEFAULT 0,
  language     TEXT    NOT NULL,
  symbol_count INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);

CREATE TABLE IF NOT EXISTS symbols (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  signature   TEXT    NOT NULL,
  body_hash   TEXT    NOT NULL,
  full_source TEXT    NOT NULL,
  is_exported INTEGER NOT NULL DEFAULT 0,
  doc_comment TEXT,
  centrality  REAL    NOT NULL DEFAULT 0.0,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  target_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  kind             TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE(source_symbol_id, target_symbol_id, kind)
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL DEFAULT 'claude-code',
  project_root TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER
);

CREATE TABLE IF NOT EXISTS observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES sessions(id),
  agent_id    TEXT    NOT NULL DEFAULT 'claude-code',
  symbol_id   INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  file_id     INTEGER REFERENCES files(id) ON DELETE SET NULL,
  scope       TEXT    NOT NULL,
  note        TEXT    NOT NULL,
  confidence  REAL    NOT NULL DEFAULT 1.0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  stale       INTEGER NOT NULL DEFAULT 0,
  stale_reason TEXT,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS capsule_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    NOT NULL REFERENCES sessions(id),
  query            TEXT    NOT NULL,
  mode             TEXT    NOT NULL DEFAULT 'feature',
  token_budget     INTEGER NOT NULL,
  tokens_used      INTEGER NOT NULL,
  symbols_included TEXT    NOT NULL,
  files_included   TEXT    NOT NULL,
  timestamp        INTEGER NOT NULL,
  followed_up      INTEGER NOT NULL DEFAULT 0,
  miss_ratio       REAL,
  noise_ratio      REAL
);

CREATE TABLE IF NOT EXISTS bm25_index (
  term           TEXT    NOT NULL,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  tf             REAL    NOT NULL,
  PRIMARY KEY (term, observation_id)
);

CREATE TABLE IF NOT EXISTS bm25_doc_lengths (
  observation_id INTEGER PRIMARY KEY,
  dl             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bm25_stats (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name,
  kind,
  content='symbols',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS file_summaries (
  file_id        INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  export_names   TEXT    NOT NULL DEFAULT '',
  symbol_count   INTEGER NOT NULL DEFAULT 0,
  edge_count     INTEGER NOT NULL DEFAULT 0,
  avg_centrality REAL    NOT NULL DEFAULT 0.0,
  summary_text   TEXT    NOT NULL DEFAULT '',
  computed_at    INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE IF NOT EXISTS file_summaries_fts USING fts5(
  summary_text,
  content='file_summaries',
  content_rowid='file_id',
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_context (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  symbol_id   INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  file_id     INTEGER REFERENCES files(id) ON DELETE CASCADE,
  query       TEXT    NOT NULL,
  relevance   REAL    NOT NULL DEFAULT 1.0,
  returned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_clusters (
  file_id    INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  cluster_id INTEGER NOT NULL
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_basename_path ON files(basename, path);
CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_body_hash ON symbols(body_hash);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_observations_symbol ON observations(symbol_id);
CREATE INDEX IF NOT EXISTS idx_observations_stale ON observations(stale);
CREATE INDEX IF NOT EXISTS idx_observations_confidence ON observations(confidence);
CREATE INDEX IF NOT EXISTS idx_capsule_log_session ON capsule_log(session_id);
CREATE INDEX IF NOT EXISTS idx_bm25_term ON bm25_index(term);
CREATE INDEX IF NOT EXISTS idx_symbols_name_cov ON symbols(name, id, file_id, kind, centrality, is_exported, start_line);
CREATE INDEX IF NOT EXISTS idx_edges_src_cov ON edges(source_symbol_id, target_symbol_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_tgt_cov ON edges(target_symbol_id, source_symbol_id, kind);
CREATE INDEX IF NOT EXISTS idx_files_path_cov ON files(path, id, hash, mtime, symbol_count, last_indexed);
CREATE INDEX IF NOT EXISTS idx_session_ctx_session ON session_context(session_id);
CREATE INDEX IF NOT EXISTS idx_session_ctx_symbol ON session_context(symbol_id);
CREATE INDEX IF NOT EXISTS idx_file_clusters_cluster ON file_clusters(cluster_id);
CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
CREATE INDEX IF NOT EXISTS idx_observations_scope ON observations(scope, archived);
`;

const FTS_SYNC = `
CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, kind) VALUES (new.id, new.name, new.kind);
END;

CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind) VALUES ('delete', old.id, old.name, old.kind);
END;

CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE OF name, kind ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, kind) VALUES ('delete', old.id, old.name, old.kind);
  INSERT INTO symbols_fts(rowid, name, kind) VALUES (new.id, new.name, new.kind);
END;

INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild');
`;

export function createSchema(db: Database.Database): void {
  db.exec(TABLES);
  db.exec(INDEXES);
  db.exec(FTS_SYNC);
}
