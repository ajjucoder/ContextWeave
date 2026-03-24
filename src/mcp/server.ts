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
import { registerExportTool } from "./tools/export.js";
import { startWatcher, stopWatcher } from "../core/watcher.js";
import { createEmbeddingRuntime, disposeEmbeddingRuntime } from "../core/embedding-runtime.js";
import { indexProject } from "../core/indexer.js";
import { updateCentralityScores } from "../core/graph.js";
import { fileQueries } from "../db/queries/files.js";
import { backfillSummariesIfNeeded } from "../core/file-summaries.js";
import { backfillClustersIfNeeded } from "../core/clusters.js";
import { createLogger } from "../utils/logger.js";
import type { ProjectConfig } from "../utils/config.js";
import { acquireServerSessionLock, releaseServerSessionLock } from "./session-lock.js";
import { syncBootstrapObservations } from "../memory/bootstrap.js";
import { promoteFrequentObservations, demoteStaleObservations } from "../memory/observations.js";

const log = createLogger("mcp-server");

let serverDb: Database.Database | null = null;

function getServerDb(projectRoot: string, isPrimary: boolean): Database.Database {
  if (serverDb) return serverDb;
  const dbPath = `${projectRoot}/.contextweave/contextweave.db`;
  serverDb = getDb(dbPath, { scheduleMaintenance: isPrimary });
  runMigrations(serverDb);
  return serverDb;
}

function scheduleDerivedDataBackfill(db: Database.Database, projectRoot: string): void {
  void Promise.resolve().then(() => {
    try {
      const backfilledSummaries = backfillSummariesIfNeeded(db);
      const backfilledClusters = backfillClustersIfNeeded(db, projectRoot);
      const promoted = promoteFrequentObservations(db);
      const demoted = demoteStaleObservations(db);
      if (backfilledSummaries || backfilledClusters) {
        log.info("backfilled derived data for existing index", {
          projectRoot,
          summaries: backfilledSummaries,
          clusters: backfilledClusters,
        });
      }
      if (promoted > 0 || demoted > 0) {
        log.info("observation promotion/demotion complete", { promoted, demoted });
      }
    } catch (error) {
      log.error("failed to backfill derived data", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function startMcpServer(projectRoot: string, config?: ProjectConfig): Promise<void> {
  const serverLock = acquireServerSessionLock(projectRoot);
  const isPrimary = serverLock.mode === "primary";
  const serverSessionId = randomUUID();

  const server = new McpServer({
    name: "contextweave",
    version: "0.1.0",
  });

  const db = getServerDb(projectRoot, isPrimary);
  const embeddingRuntime = await createEmbeddingRuntime(db, {
    modelName: config?.embeddingModel,
  });
  const indexedFileCount = fileQueries(db).count();
  if (indexedFileCount === 0) {
    log.info("empty index detected — running auto-index", { projectRoot });
    try {
      await indexProject(db, projectRoot);
      updateCentralityScores(db);
      log.info("auto-index complete", { projectRoot });
    } catch (error) {
      log.error("auto-index failed", {
        projectRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  scheduleDerivedDataBackfill(db, projectRoot);
  syncBootstrapObservations(db, projectRoot);

  log.info("acquired server lock", { mode: serverLock.mode, projectRoot });

  registerCapsuleTool(server, db, projectRoot, config, serverSessionId, embeddingRuntime);
  registerImpactTool(server, db);
  registerFlowTool(server, db);
  registerRecallTool(server, db);
  registerStatusTool(server, db, projectRoot);
  registerOverviewTool(server, db, projectRoot, embeddingRuntime);
  registerFilesTool(server, db, projectRoot);
  registerSearchTool(server, db, projectRoot);
  registerReadTool(server, db, projectRoot);
  registerStatsTool(server, db, projectRoot, serverSessionId);
  registerExportTool(server, db, projectRoot);

  registerReindexTool(server, db, projectRoot, config, embeddingRuntime);
  if (isPrimary) {
    registerRememberTool(server, db, serverSessionId, projectRoot);
  } else {
    log.info("secondary mode: skipping cw_remember", { projectRoot });
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

    try {
      await disposeEmbeddingRuntime(embeddingRuntime);
    } catch (error) {
      log.error("failed to dispose embedding runtime", {
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
      await startWatcher({
        projectRoot,
        db,
        ignore: config?.ignore,
        embeddingRuntime,
        sessionId: serverSessionId,
      });
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
