import * as parcelWatcher from "@parcel/watcher";
import type Database from "better-sqlite3";
import { basename, resolve } from "node:path";
import type { IndexDiff } from "./types.js";
import { BUILTIN_IGNORE_PATTERNS, indexProject, indexSingleFile, isIgnoredForIndexing, isSecurityExcludedPath, removeFile } from "./indexer.js";
import { detectLanguage } from "./parser.js";
import { StalenessEngine } from "../memory/staleness.js";
import { fileQueries } from "../db/queries/files.js";
import { createLogger } from "../utils/logger.js";
import { captureFileChangeObservation } from "../memory/passive.js";

const log = createLogger("watcher");

export interface WatcherOptions {
  projectRoot: string;
  db: Database.Database;
  ignore?: string[];
  sessionId?: string;
  onReindex?: (filePath: string, symbolCount: number) => void;
  onRemove?: (filePath: string) => void;
  onError?: (error: Error) => void;
  onDiff?: (filePath: string, diff: IndexDiff, fileId: number) => void;
}

const activeSubscriptions = new Map<string, parcelWatcher.AsyncSubscription>();
const IGNORE_CONTROL_FILES = new Set([".gitignore", ".cwignore"]);

export async function startWatcher(options: WatcherOptions): Promise<void> {
  const existingSubscription = activeSubscriptions.get(options.projectRoot);
  if (existingSubscription) {
    log.warn("watcher already active, closing previous");
    await existingSubscription.unsubscribe();
    activeSubscriptions.delete(options.projectRoot);
  }

  const { projectRoot, db, ignore, sessionId, onReindex, onRemove, onError, onDiff } = options;
  const staleness = new StalenessEngine(db);
  const files = fileQueries(db);
  const allIgnore = [...BUILTIN_IGNORE_PATTERNS, ...(ignore ?? [])];
  const resolvedRoot = resolve(projectRoot).replace(/\\/g, "/");
  const isIgnoreControlFile = (filePath: string): boolean => (
    IGNORE_CONTROL_FILES.has(basename(filePath)) &&
    resolve(filePath).replace(/\\/g, "/").startsWith(`${resolvedRoot}/`)
  );

  let fullReindexInFlight: Promise<void> | null = null;
  let fullReindexQueued = false;

  const scheduleFullReindex = () => {
    if (fullReindexInFlight) {
      fullReindexQueued = true;
      return;
    }

    fullReindexInFlight = (async () => {
      do {
        fullReindexQueued = false;
        try {
          const result = await indexProject(db, projectRoot, ignore);
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

  const handleChange = (filePath: string) => {
    if (isSecurityExcludedPath(filePath, projectRoot) || isIgnoredForIndexing(filePath, projectRoot, ignore)) {
      log.debug(`skipping ignored file change ${filePath}`);
      return;
    }

    const language = detectLanguage(filePath);
    if (!language) return;

    try {
      const result = indexSingleFile(db, filePath, projectRoot, ignore);
      log.debug(`reindexed ${filePath}: ${result.symbolCount} symbols`);

      if (result.diff) {
        const fileRecord = files.getByPath(filePath);
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
      removeFile(db, filePath);
      log.debug(`removed ${filePath} from index`);
      onRemove?.(filePath);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`failed to remove ${filePath}`, error);
      onError?.(error);
    }
  };

  const subscription = await parcelWatcher.subscribe(
    projectRoot,
    (err, events) => {
      if (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error("watcher error", error);
        onError?.(error);
        return;
      }

      for (const event of events) {
        if (isIgnoreControlFile(event.path)) {
          scheduleFullReindex();
          continue;
        }

        if (event.type === "delete") {
          handleRemove(event.path);
        } else {
          handleChange(event.path);
        }
      }
    },
    {
      ignore: allIgnore.map((p) => `**/${p}/**`),
    }
  );
  activeSubscriptions.set(projectRoot, subscription);

  log.info("file watcher started", { projectRoot });
}

export async function stopWatcher(projectRoot?: string): Promise<void> {
  if (projectRoot) {
    const subscription = activeSubscriptions.get(projectRoot);
    if (!subscription) return;
    await subscription.unsubscribe();
    activeSubscriptions.delete(projectRoot);
    log.info("file watcher stopped", { projectRoot });
    return;
  }

  if (activeSubscriptions.size === 0) return;
  for (const [root, subscription] of activeSubscriptions) {
    await subscription.unsubscribe();
    log.info("file watcher stopped", { projectRoot: root });
  }
  activeSubscriptions.clear();
}
