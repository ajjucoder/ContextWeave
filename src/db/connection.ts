import Database from "better-sqlite3";
import { statSync, unlinkSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

const dbInstances = new Map<string, Database.Database>();
const DEFAULT_MAX_DB_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB
const MAINTENANCE_THRESHOLD_BYTES = 512 * 1024 * 1024; // 512MB

function isInMemoryPath(dbPath: string): boolean {
  return dbPath === ":memory:" || dbPath.startsWith("file::memory:");
}

function normalizeDbPath(dbPath: string): string {
  if (isInMemoryPath(dbPath)) return dbPath;
  if (dbPath.startsWith("file:")) return dbPath;
  return resolve(dbPath);
}

function openAndConfigure(dbPath: string): Database.Database {
  const instance = new Database(dbPath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("synchronous = NORMAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("cache_size = -32000");
  instance.pragma("busy_timeout = 5000");
  instance.pragma("auto_vacuum = INCREMENTAL");
  const autoVacuumMode = instance.pragma("auto_vacuum", { simple: true }) as number;
  if (autoVacuumMode !== 2) {
    instance.exec("VACUUM");
  }
  instance.pragma("wal_autocheckpoint = 1000");
  instance.pragma(`journal_size_limit = ${64 * 1024 * 1024}`);
  return instance;
}

function getMaxDbSizeBytes(): number {
  const raw = process.env["CONTEXTWEAVE_MAX_DB_BYTES"];
  if (!raw) return DEFAULT_MAX_DB_SIZE_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_DB_SIZE_BYTES;
  return parsed;
}

function enforceDbSizeLimit(dbPath: string): void {
  if (isInMemoryPath(dbPath) || dbPath.startsWith("file:")) return;

  try {
    const size = statSync(dbPath).size;
    const maxBytes = getMaxDbSizeBytes();
    if (size > maxBytes) {
      throw new Error(`Database ${dbPath} exceeds max size limit (${size} bytes > ${maxBytes} bytes)`);
    }
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return;
    throw err;
  }
}

function maybeRunMaintenance(instance: Database.Database, dbPath: string): void {
  if (isInMemoryPath(dbPath) || dbPath.startsWith("file:")) return;
  try {
    const size = statSync(dbPath).size;
    if (size < MAINTENANCE_THRESHOLD_BYTES) return;
    instance.pragma("wal_checkpoint(TRUNCATE)");
    instance.exec("PRAGMA incremental_vacuum(2000)");
    log.info("ran incremental DB maintenance", { path: dbPath, size });
  } catch (err) {
    log.warn("db maintenance skipped", {
      path: dbPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
  const normalizedPath = normalizeDbPath(dbPath);
  const existing = dbInstances.get(normalizedPath);
  if (existing) return existing;

  enforceDbSizeLimit(normalizedPath);

  log.info("opening database", { path: normalizedPath });

  try {
    const instance = openAndConfigure(normalizedPath);
    maybeRunMaintenance(instance, normalizedPath);
    dbInstances.set(normalizedPath, instance);
    return instance;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("database open failed, attempting recovery", { path: normalizedPath, error: message });

    try {
      const stale = dbInstances.get(normalizedPath);
      if (stale) {
        stale.close();
        dbInstances.delete(normalizedPath);
      }
    } catch {
    }

    if (!isInMemoryPath(normalizedPath) && !normalizedPath.startsWith("file:")) {
      removeCorruptFiles(normalizedPath);
    }

    const recovered = openAndConfigure(normalizedPath);
    dbInstances.set(normalizedPath, recovered);
    log.info("created fresh database after corruption recovery");
    return recovered;
  }
}

export function closeDb(dbPath?: string): void {
  if (dbPath) {
    const normalizedPath = normalizeDbPath(dbPath);
    const instance = dbInstances.get(normalizedPath);
    if (!instance) return;
    log.info("closing database", { path: normalizedPath });
    instance.close();
    dbInstances.delete(normalizedPath);
    return;
  }

  if (dbInstances.size === 0) return;
  for (const [path, instance] of dbInstances) {
    log.info("closing database", { path });
    instance.close();
  }
  dbInstances.clear();
}

export function getExistingDb(dbPath?: string): Database.Database | null {
  if (dbPath) {
    return dbInstances.get(normalizeDbPath(dbPath)) ?? null;
  }
  const first = dbInstances.values().next();
  return first.done ? null : first.value;
}
