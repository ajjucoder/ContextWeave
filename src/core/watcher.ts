import * as parcelWatcher from "@parcel/watcher";
import type Database from "better-sqlite3";
import type { IndexDiff } from "./types.js";
import { indexSingleFile, removeFile } from "./indexer.js";
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

let activeSubscription: parcelWatcher.AsyncSubscription | null = null;

const BUILTIN_IGNORE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".contextweave",
  "coverage",
  "venv",
  ".venv",
  "env",
  "target",
  ".tox",
  "vendor",
  ".bundle",
  "__pycache__",
];

export async function startWatcher(options: WatcherOptions): Promise<void> {
  if (activeSubscription) {
    log.warn("watcher already active, closing previous");
    await activeSubscription.unsubscribe();
    activeSubscription = null;
  }

  const { projectRoot, db, ignore, sessionId, onReindex, onRemove, onError, onDiff } = options;
  const staleness = new StalenessEngine(db);
  const files = fileQueries(db);
  const allIgnore = [...BUILTIN_IGNORE, ...(ignore ?? [])];

  const handleChange = (filePath: string) => {
    const language = detectLanguage(filePath);
    if (!language) return;

    try {
      const result = indexSingleFile(db, filePath, projectRoot);
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

  activeSubscription = await parcelWatcher.subscribe(
    projectRoot,
    (err, events) => {
      if (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error("watcher error", error);
        onError?.(error);
        return;
      }

      for (const event of events) {
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

  log.info("file watcher started", { projectRoot });
}

export async function stopWatcher(): Promise<void> {
  if (!activeSubscription) return;
  await activeSubscription.unsubscribe();
  activeSubscription = null;
  log.info("file watcher stopped");
}
