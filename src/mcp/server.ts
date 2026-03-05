import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb, closeDb } from "../db/connection.js";
import { runMigrations } from "../db/migrations.js";
import { registerCapsuleTool } from "./tools/capsule.js";
import { registerImpactTool } from "./tools/impact.js";
import { registerFlowTool } from "./tools/flow.js";
import { registerRememberTool } from "./tools/remember.js";
import { registerRecallTool } from "./tools/recall.js";
import { registerStatusTool } from "./tools/status.js";
import { registerReindexTool } from "./tools/reindex.js";
import { registerOverviewTool } from "./tools/overview.js";
import { registerFilesTool } from "./tools/files.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { registerStatsTool } from "./tools/stats.js";
import { startWatcher, stopWatcher } from "../core/watcher.js";
import { createLogger } from "../utils/logger.js";
import type { ProjectConfig } from "../utils/config.js";
import { acquireServerSessionLock, releaseServerSessionLock } from "./session-lock.js";

const log = createLogger("mcp-server");

let serverDb: Database.Database | null = null;

export function getServerDb(projectRoot: string): Database.Database {
  if (serverDb) return serverDb;
  const dbPath = `${projectRoot}/.contextweave/contextweave.db`;
  serverDb = getDb(dbPath);
  runMigrations(serverDb);
  return serverDb;
}

export async function startMcpServer(projectRoot: string, config?: ProjectConfig): Promise<void> {
  const serverLock = acquireServerSessionLock(projectRoot);
  const isPrimary = serverLock.mode === "primary";
  const serverSessionId = randomUUID();

  const server = new McpServer({
    name: "contextweave",
    version: "0.1.0",
  });

  const db = getServerDb(projectRoot);

  log.info("acquired server lock", { mode: serverLock.mode, projectRoot });

  registerCapsuleTool(server, db, projectRoot, config, serverSessionId);
  registerImpactTool(server, db);
  registerFlowTool(server, db);
  registerRecallTool(server, db);
  registerStatusTool(server, db, projectRoot);
  registerOverviewTool(server, db, projectRoot);
  registerFilesTool(server, db, projectRoot);
  registerSearchTool(server, db, projectRoot);
  registerReadTool(server, db, projectRoot);
  registerStatsTool(server, db, projectRoot, serverSessionId);

  if (isPrimary) {
    registerRememberTool(server, db, serverSessionId, projectRoot);
    registerReindexTool(server, db, projectRoot, config);
  } else {
    log.info("secondary mode: skipping write-heavy tools", { projectRoot });
  }

  const transport = new StdioServerTransport();
  let watcherStarted = false;
  let shuttingDown: Promise<void> | null = null;

  async function cleanupResources(reason: string): Promise<void> {
    try {
      if (watcherStarted) {
        await stopWatcher(projectRoot);
      }
    } catch (error) {
      log.error("failed to stop file watcher", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      closeDb();
      serverDb = null;
    } catch (error) {
      log.error("failed to close database", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    releaseServerSessionLock(serverLock);
  }

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return shuttingDown;

    shuttingDown = (async () => {
      log.info("shutting down", { signal });
      await cleanupResources(`signal:${signal}`);
      process.exit(0);
    })();

    return shuttingDown;
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("uncaughtException", (err) => {
    log.error("uncaught exception", { error: err.message, stack: err.stack });
    void shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    log.error("unhandled rejection", { error: message });
  });

  try {
    if (isPrimary) {
      await startWatcher({ projectRoot, db, ignore: config?.ignore, sessionId: serverSessionId });
      watcherStarted = true;
      log.info("file watcher started", { projectRoot });
    } else {
      log.info("secondary mode: watcher disabled", { projectRoot });
    }

    log.info("starting MCP server", { projectRoot });
    await server.connect(transport);
  } catch (error) {
    await cleanupResources("startup_failure");
    throw error;
  }
}
