import { basename, relative, resolve } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type Database from "better-sqlite3";
import type { EmbeddingRuntime, IndexDiff } from "./types.js";
import { BUILTIN_IGNORE_PATTERNS, indexProject, indexSingleFile, isIgnoredForIndexing, isSecurityExcludedPath, removeFile } from "./indexer.js";
import { detectLanguage } from "./parser.js";
import { StalenessEngine } from "../memory/staleness.js";
import { fileQueries } from "../db/queries/files.js";
import { createLogger } from "../utils/logger.js";
import { captureFileChangeObservation } from "../memory/passive.js";

const log = createLogger("watcher-v2");
const IGNORE_CONTROL_FILES = new Set([".gitignore", ".cwignore"]);
const DEBOUNCE_MS = 2_000;
const DUPLICATE_SUPPRESSION_MS = 10_000;

export interface WatcherOptions {
  projectRoot: string;
  db: Database.Database;
  ignore?: string[];
  embeddingRuntime?: EmbeddingRuntime | null;
  sessionId?: string;
  onReindex?: (filePath: string, symbolCount: number) => void;
  onRemove?: (filePath: string) => void;
  onError?: (error: Error) => void;
  onDiff?: (filePath: string, diff: IndexDiff, fileId: number) => void;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

interface ActiveWatcherState {
  watcher: FSWatcher;
  pendingReindexes: Map<string, TimeoutHandle>;
  recentProcessed: Map<string, TimeoutHandle>;
}

const activeWatchers = new Map<string, ActiveWatcherState>();

/**
 * Starts the chokidar-based watcher used by the primary MCP session.
 */
export async function startWatcher(options: WatcherOptions): Promise<void> {
  const existingWatcher = activeWatchers.get(options.projectRoot);
  if (existingWatcher) {
    log.warn("watcher already active, closing previous");
    await closeWatcherState(options.projectRoot, existingWatcher);
  }

  const { projectRoot, db, ignore, embeddingRuntime, sessionId, onReindex, onRemove, onError, onDiff } = options;
  const staleness = new StalenessEngine(db);
  const files = fileQueries(db);
  const allIgnore = [...BUILTIN_IGNORE_PATTERNS, ...(ignore ?? [])];
  const resolvedRoot = resolve(projectRoot).replace(/\\/g, "/");

  const pendingReindexes = new Map<string, TimeoutHandle>();
  const recentProcessed = new Map<string, TimeoutHandle>();
  let fullReindexInFlight: Promise<void> | null = null;
  let fullReindexQueued = false;

  const isIgnoreControlFile = (filePath: string): boolean => (
    IGNORE_CONTROL_FILES.has(basename(filePath)) &&
    resolve(filePath).replace(/\\/g, "/").startsWith(`${resolvedRoot}/`)
  );

  const clearPending = (filePath: string): void => {
    const pending = pendingReindexes.get(filePath);
    if (!pending) return;
    clearTimeout(pending);
    pendingReindexes.delete(filePath);
  };

  const clearRecentProcessed = (filePath: string): void => {
    const suppressionTimer = recentProcessed.get(filePath);
    if (!suppressionTimer) return;
    clearTimeout(suppressionTimer);
    recentProcessed.delete(filePath);
  };

  const markRecentlyProcessed = (filePath: string): void => {
    clearRecentProcessed(filePath);
    recentProcessed.set(filePath, setTimeout(() => {
      recentProcessed.delete(filePath);
    }, DUPLICATE_SUPPRESSION_MS));
  };

  const isDuplicate = (filePath: string): boolean => recentProcessed.has(filePath);

  const scheduleFullReindex = () => {
    if (fullReindexInFlight) {
      fullReindexQueued = true;
      return;
    }

    fullReindexInFlight = (async () => {
      do {
        fullReindexQueued = false;
        try {
          const result = await indexProject(db, projectRoot, ignore, { embeddings: embeddingRuntime });
          log.info("reindexed project due ignore-file change", {
            filesIndexed: result.filesIndexed,
            symbolsFound: result.symbolsFound,
            errors: result.errors.length,
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          onError?.(error);
          log.error("failed to reindex after ignore-file change", error);
        }
      } while (fullReindexQueued);
      fullReindexInFlight = null;
    })();
  };

  const handleChange = async (filePath: string) => {
    if (isSecurityExcludedPath(filePath, projectRoot) || isIgnoredForIndexing(filePath, projectRoot, ignore)) {
      log.debug(`skipping ignored file change ${filePath}`);
      return;
    }

    if (isDuplicate(filePath)) {
      log.debug(`suppressing duplicate file change ${filePath}`);
      return;
    }

    const language = detectLanguage(filePath);
    if (!language) return;

    try {
      const result = await indexSingleFile(db, filePath, projectRoot, ignore, {
        embeddings: embeddingRuntime,
      });
      markRecentlyProcessed(filePath);
      log.debug(`reindexed ${filePath}: ${result.symbolCount} symbols`);

      if (result.diff) {
        const relPath = relative(projectRoot, filePath).replace(/\\/g, "/");
        const fileRecord = files.getByPath(relPath);
        if (fileRecord) {
          staleness.propagateFromDiff(result.diff, fileRecord.id);
          captureFileChangeObservation(db, filePath, result.diff, fileRecord.id, sessionId ?? "default", projectRoot);
          onDiff?.(filePath, result.diff, fileRecord.id);
        }
      }

      onReindex?.(filePath, result.symbolCount);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`failed to reindex ${filePath}`, error);
      onError?.(error);
    }
  };

  const handleRemove = (filePath: string) => {
    const language = detectLanguage(filePath);
    if (!language) return;

    try {
      clearRecentProcessed(filePath);
      removeFile(db, filePath, projectRoot);
      markRecentlyProcessed(filePath);
      log.debug(`removed ${filePath} from index`);
      onRemove?.(filePath);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`failed to remove ${filePath}`, error);
      onError?.(error);
    }
  };

  const scheduleChange = (filePath: string): void => {
    clearPending(filePath);
    pendingReindexes.set(filePath, setTimeout(() => {
      pendingReindexes.delete(filePath);
      void handleChange(filePath);
    }, DEBOUNCE_MS));
  };

  const watcher = watch(projectRoot, {
    ignoreInitial: true,
    ignored: allIgnore.map((pattern) => `**/${pattern}/**`),
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  watcher.on("all", (eventName, filePath) => {
    if (typeof filePath !== "string") return;

    clearPending(filePath);

    if (isIgnoreControlFile(filePath)) {
      scheduleFullReindex();
      return;
    }

    if (eventName === "unlink") {
      handleRemove(filePath);
      return;
    }

    if (eventName === "add" || eventName === "change") {
      scheduleChange(filePath);
    }
  });

  watcher.on("error", (err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error("watcher error", error);
    onError?.(error);
  });

  activeWatchers.set(projectRoot, {
    watcher,
    pendingReindexes,
    recentProcessed,
  });

  log.info("file watcher started", { projectRoot, debounceMs: DEBOUNCE_MS, duplicateSuppressionMs: DUPLICATE_SUPPRESSION_MS });
}

/**
 * Stops one or all active watcher-v2 instances and clears scheduled work.
 */
export async function stopWatcher(projectRoot?: string): Promise<void> {
  if (projectRoot) {
    const watcherState = activeWatchers.get(projectRoot);
    if (!watcherState) return;
    await closeWatcherState(projectRoot, watcherState);
    return;
  }

  for (const [root, watcherState] of activeWatchers) {
    await closeWatcherState(root, watcherState);
  }
}

async function closeWatcherState(projectRoot: string, watcherState: ActiveWatcherState): Promise<void> {
  for (const pending of watcherState.pendingReindexes.values()) {
    clearTimeout(pending);
  }
  watcherState.pendingReindexes.clear();

  for (const suppressionTimer of watcherState.recentProcessed.values()) {
    clearTimeout(suppressionTimer);
  }
  watcherState.recentProcessed.clear();

  await watcherState.watcher.close();
  activeWatchers.delete(projectRoot);
  log.info("file watcher stopped", { projectRoot });
}
