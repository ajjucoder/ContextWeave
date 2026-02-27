import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerSessionLock {
  fd: number;
  lockPath: string;
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
  const payload = `${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`;

  const tryAcquire = (): ServerSessionLock => {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, payload, "utf-8");
    return { fd, lockPath };
  };

  try {
    return tryAcquire();
  } catch {
    const existingPid = readLockPid(lockPath);
    if (existingPid !== null && !isProcessAlive(existingPid)) {
      try {
        unlinkSync(lockPath);
      } catch {
      }
      return tryAcquire();
    }

    const pidDetail = existingPid !== null ? ` (pid ${existingPid})` : "";
    throw new Error(
      `ContextWeave server lock already held${pidDetail}. Stop the other session or remove stale lock "${lockPath}".`
    );
  }
}

export function releaseServerSessionLock(lock: ServerSessionLock | null): void {
  if (!lock) return;
  try {
    closeSync(lock.fd);
  } catch {
  }

  try {
    unlinkSync(lock.lockPath);
  } catch {
  }
}
