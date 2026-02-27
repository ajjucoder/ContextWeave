import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type LockMode = "primary" | "secondary";

export interface ServerSessionLock {
  fd: number | null;
  lockPath: string;
  mode: LockMode;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const raw = readFileSync(lockPath, "utf-8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pid?: unknown };
    const pid = typeof parsed.pid === "number" ? parsed.pid : Number.NaN;
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function acquireServerSessionLock(projectRoot: string): ServerSessionLock {
  const lockPath = resolve(projectRoot, ".contextweave", "mcp-server.lock");
  const payload = `${JSON.stringify({ pid: process.pid, mode: "primary", createdAt: Date.now() })}\n`;

  const tryAcquire = (): ServerSessionLock => {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, payload, "utf-8");
    return { fd, lockPath, mode: "primary" };
  };

  try {
    return tryAcquire();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EEXIST") throw error;

    const existingPid = readLockPid(lockPath);
    if (existingPid !== null && !isProcessAlive(existingPid)) {
      try {
        unlinkSync(lockPath);
      } catch {
      }

      try {
        return tryAcquire();
      } catch (retryError) {
        const retryErr = retryError as NodeJS.ErrnoException;
        if (retryErr.code !== "EEXIST") throw retryError;
      }
    }

    return { fd: null, lockPath, mode: "secondary" };
  }
}

export function releaseServerSessionLock(lock: ServerSessionLock | null): void {
  if (!lock) return;
  if (lock.mode !== "primary") return;

  try {
    if (lock.fd !== null) {
      closeSync(lock.fd);
    }
  } catch {
  }

  const lockPid = readLockPid(lock.lockPath);
  if (lockPid !== null && lockPid !== process.pid) {
    return;
  }

  try {
    unlinkSync(lock.lockPath);
  } catch {
  }
}
