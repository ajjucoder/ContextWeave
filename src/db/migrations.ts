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
