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
import { startWatcher, stopWatcher } from "../core/watcher.js";
import { createLogger } from "../utils/logger.js";
import type { ProjectConfig } from "../utils/config.js";

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
  const serverSessionId = randomUUID();

  const server = new McpServer({
    name: "contextweave",
    version: "0.1.0",
  });

  const db = getServerDb(projectRoot);

  registerCapsuleTool(server, db, projectRoot, config, serverSessionId);
  registerImpactTool(server, db);
  registerFlowTool(server, db);
  registerRememberTool(server, db, serverSessionId, projectRoot);
  registerRecallTool(server, db);
  registerStatusTool(server, db, projectRoot);
  registerReindexTool(server, db, projectRoot);

  const transport = new StdioServerTransport();
  let watcherStarted = false;
  let shuttingDown: Promise<void> | null = null;

  async function cleanupResources(reason: string): Promise<void> {
    try {
      if (watcherStarted) {
        await stopWatcher();
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
    await startWatcher({ projectRoot, db, ignore: config?.ignore, sessionId: serverSessionId });
    watcherStarted = true;
    log.info("file watcher started", { projectRoot });

    log.info("starting MCP server", { projectRoot });
    await server.connect(transport);
  } catch (error) {
    await cleanupResources("startup_failure");
    throw error;
  }
}
