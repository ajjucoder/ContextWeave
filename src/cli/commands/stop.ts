import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export function runStop(projectRoot: string): void {
  const pidPath = resolve(projectRoot, ".contextweave", "cw.pid");

  if (!existsSync(pidPath)) {
    process.stdout.write("No ContextWeave daemon PID file found.\n");
    return;
  }

  const raw = readFileSync(pidPath, "utf-8").trim();
  const pid = Number(raw);

  if (!Number.isFinite(pid) || pid <= 0) {
    rmSync(pidPath, { force: true });
    process.stdout.write("Removed invalid daemon PID file.\n");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    process.stdout.write(`Stopped ContextWeave daemon (pid ${pid}).\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`Daemon process ${pid} not running (${message}).\n`);
  } finally {
    rmSync(pidPath, { force: true });
  }
}
