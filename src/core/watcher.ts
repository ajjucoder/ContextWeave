import { watch, type FSWatcher } from "chokidar";
import type Database from "better-sqlite3";
import type { IndexDiff } from "./types.js";
import { indexSingleFile, removeFile } from "./indexer.js";
import { detectLanguage } from "./parser.js";
import { StalenessEngine } from "../memory/staleness.js";
import { fileQueries } from "../db/queries/files.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("watcher");

export interface WatcherOptions {
  projectRoot: string;
  db: Database.Database;
  ignore?: string[];
  onReindex?: (filePath: string, symbolCount: number) => void;
  onRemove?: (filePath: string) => void;
  onError?: (error: Error) => void;
  onDiff?: (filePath: string, diff: IndexDiff, fileId: number) => void;
}

let activeWatcher: FSWatcher | null = null;

export function startWatcher(options: WatcherOptions): FSWatcher {
  if (activeWatcher) {
    log.warn("watcher already active, closing previous");
    activeWatcher.close();
  }

  const { projectRoot, db, ignore, onReindex, onRemove, onError, onDiff } = options;

  const staleness = new StalenessEngine(db);
  const files = fileQueries(db);

  const builtinIgnored = [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/.next/**",
    "**/.contextweave/**",
    "**/coverage/**",
  ];
  const configIgnored = (ignore ?? []).map((p) => `**/${p}/**`);
  const allIgnored = [...new Set([...builtinIgnored, ...configIgnored])];

  const watcher = watch(projectRoot, {
    ignored: allIgnored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

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
          onDiff?.(filePath, result.diff, fileRecord.id);
        }
      }

      onReindex?.(filePath, result.symbolCount);
    } catch (err) {
      log.error(`failed to reindex ${filePath}`, err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
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
      log.error(`failed to remove ${filePath}`, err);
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  watcher
    .on("add", handleChange)
    .on("change", handleChange)
    .on("unlink", handleRemove)
    .on("error", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error("watcher error", error);
      onError?.(error);
    });

  activeWatcher = watcher;
  log.info("file watcher started", { projectRoot });

  return watcher;
}

export function stopWatcher(): void {
  if (!activeWatcher) return;
  activeWatcher.close();
  activeWatcher = null;
  log.info("file watcher stopped");
}
