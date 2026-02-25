import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  const server = new McpServer({
    name: "contextweave",
    version: "0.1.0",
  });

  const db = getServerDb(projectRoot);

  registerCapsuleTool(server, db, projectRoot, config);
  registerImpactTool(server, db);
  registerFlowTool(server, db);
  registerRememberTool(server, db);
  registerRecallTool(server, db);
  registerStatusTool(server, db, projectRoot);
  registerReindexTool(server, db, projectRoot);

  startWatcher({ projectRoot, db });
  log.info("file watcher started", { projectRoot });

  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    log.info("shutting down");
    stopWatcher();
    closeDb();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("shutting down");
    stopWatcher();
    closeDb();
    process.exit(0);
  });

  log.info("starting MCP server", { projectRoot });
  await server.connect(transport);
}
