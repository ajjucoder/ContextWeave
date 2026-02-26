import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { startMcpServer } from "../../mcp/server.js";
import { loadConfig } from "../../utils/config.js";
import { createLogger } from "../../utils/logger.js";
import { autoInit } from "./init.js";

const log = createLogger("cli:serve");

interface ServeOptions {
  daemon?: boolean;
  daemonChild?: boolean;
}

function pidIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runServe(projectRoot: string, options: ServeOptions = {}): Promise<void> {
  const cwDir = resolve(projectRoot, ".contextweave");

  if (!existsSync(cwDir)) {
    await autoInit(projectRoot);
  }

  const pidPath = resolve(cwDir, "cw.pid");

  if (options.daemon && !options.daemonChild) {
    if (existsSync(pidPath)) {
      const rawPid = readFileSync(pidPath, "utf-8").trim();
      const pid = Number(rawPid);
      if (Number.isFinite(pid) && pid > 0 && pidIsRunning(pid)) {
        process.stdout.write(`ContextWeave daemon already running (pid ${pid}).\n`);
        return;
      }
      rmSync(pidPath, { force: true });
    }

    const scriptPath = process.argv[1];
    if (!scriptPath) {
      throw new Error("Unable to determine executable script path for daemon mode.");
    }

    const child = spawn(process.execPath, [scriptPath, "serve", "--daemon-child"], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    writeFileSync(pidPath, `${child.pid}\n`, "utf-8");
    process.stdout.write(`Started ContextWeave daemon (pid ${child.pid}).\n`);
    process.stdout.write(`PID file: ${pidPath}\n`);
    return;
  }

  const config = loadConfig(projectRoot);
  log.info("starting MCP server", {
    projectRoot,
    tokenBudget: config.tokenBudget,
    defaultMode: config.defaultMode,
    daemon: options.daemonChild === true,
  });
  await startMcpServer(projectRoot, config);
}
