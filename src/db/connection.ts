import Database from "better-sqlite3";
import { statSync, unlinkSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db");

const dbInstances = new Map<string, Database.Database>();
const maintenanceIntervals = new Map<string, NodeJS.Timeout>();
const activeMaintenance = new Set<string>();
const DEFAULT_MAX_DB_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB
const MAINTENANCE_THRESHOLD_BYTES = 512 * 1024 * 1024; // 512MB
const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000;

export interface DbConnectionOptions {
  scheduleMaintenance?: boolean;
}

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
  instance.pragma(`mmap_size = ${256 * 1024 * 1024}`);
  instance.pragma("temp_store = MEMORY");
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

function runMaintenanceWithGuard(instance: Database.Database, dbPath: string): void {
  if (activeMaintenance.has(dbPath)) {
    log.debug("db maintenance already running", { path: dbPath });
    return;
  }

  activeMaintenance.add(dbPath);
  try {
    maybeRunMaintenance(instance, dbPath);
  } finally {
    activeMaintenance.delete(dbPath);
  }
}

function ensureMaintenanceSchedule(instance: Database.Database, dbPath: string): void {
  if (maintenanceIntervals.has(dbPath)) return;
  if (isInMemoryPath(dbPath) || dbPath.startsWith("file:")) return;

  const interval = setInterval(() => {
    runMaintenanceWithGuard(instance, dbPath);
  }, MAINTENANCE_INTERVAL_MS);
  interval.unref?.();
  maintenanceIntervals.set(dbPath, interval);
}

function clearMaintenanceSchedule(dbPath: string): void {
  const interval = maintenanceIntervals.get(dbPath);
  if (!interval) return;
  clearInterval(interval);
  maintenanceIntervals.delete(dbPath);
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

export function getDb(dbPath: string, options: DbConnectionOptions = {}): Database.Database {
  const normalizedPath = normalizeDbPath(dbPath);
  const existing = dbInstances.get(normalizedPath);
  if (existing) {
    if (options.scheduleMaintenance) {
      ensureMaintenanceSchedule(existing, normalizedPath);
    }
    return existing;
  }

  enforceDbSizeLimit(normalizedPath);

  log.info("opening database", { path: normalizedPath });

  try {
    const instance = openAndConfigure(normalizedPath);
    runMaintenanceWithGuard(instance, normalizedPath);
    if (options.scheduleMaintenance) {
      ensureMaintenanceSchedule(instance, normalizedPath);
    }
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
    runMaintenanceWithGuard(recovered, normalizedPath);
    if (options.scheduleMaintenance) {
      ensureMaintenanceSchedule(recovered, normalizedPath);
    }
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
    clearMaintenanceSchedule(normalizedPath);
    activeMaintenance.delete(normalizedPath);
    instance.close();
    dbInstances.delete(normalizedPath);
    return;
  }

  if (dbInstances.size === 0) return;
  for (const [path, instance] of dbInstances) {
    log.info("closing database", { path });
    clearMaintenanceSchedule(path);
    activeMaintenance.delete(path);
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
