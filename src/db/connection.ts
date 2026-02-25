import Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

let db: Database.Database | null = null;

export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  log.info("opening database", { path: dbPath });
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("cache_size = -32000");
  db.pragma("busy_timeout = 5000");

  return db;
}

export function closeDb(): void {
  if (!db) return;
  log.info("closing database");
  db.close();
  db = null;
}

export function getExistingDb(): Database.Database | null {
  return db;
}
