import Database from "better-sqlite3";
import { unlinkSync, renameSync } from "node:fs";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

let db: Database.Database | null = null;

function openAndConfigure(dbPath: string): Database.Database {
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("synchronous = NORMAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("cache_size = -32000");
  instance.pragma("busy_timeout = 5000");
  return instance;
}

function removeCorruptFiles(dbPath: string): void {
  try {
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    renameSync(dbPath, backupPath);
    log.info("moved corrupt database", { from: dbPath, to: backupPath });
  } catch {
    try {
      unlinkSync(dbPath);
    } catch {
    }
  }

  for (const suffix of ["-wal", "-shm"]) {
    try {
      unlinkSync(`${dbPath}${suffix}`);
    } catch {
    }
  }
}

export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  log.info("opening database", { path: dbPath });

  try {
    db = openAndConfigure(dbPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("database open failed, attempting recovery", { path: dbPath, error: message });

    try {
      if (db) {
        db.close();
        db = null;
      }
    } catch {
    }

    removeCorruptFiles(dbPath);

    db = openAndConfigure(dbPath);
    log.info("created fresh database after corruption recovery");
  }

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
