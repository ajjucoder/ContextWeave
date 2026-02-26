import type Database from "better-sqlite3";
import type { IndexDiff } from "../core/types.js";
import { ObservationStore } from "./observations.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("passive-observations");

export function captureQueryObservation(
  db: Database.Database,
  query: string,
  pivotSymbolIds: Set<number>,
  sessionId: string,
  _projectRoot: string
): void {
  if (pivotSymbolIds.size === 0) return;

  try {
    const symbols = symbolQueries(db);
    const pivotArray = [...pivotSymbolIds];
    const names: string[] = [];

    for (const id of pivotArray) {
      const symbol = symbols.getById(id);
      if (symbol) names.push(symbol.name);
    }

    const store = new ObservationStore(db);
    store.create({
      sessionId,
      scope: "passive",
      note: `[auto] Query: "${query}" resolved to: ${names.join(", ")}`,
      symbolId: pivotArray[0],
      confidence: 0.5,
    });
  } catch (err) {
    log.debug("failed to capture query observation", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function captureFileChangeObservation(
  db: Database.Database,
  filePath: string,
  diff: IndexDiff,
  fileId: number,
  sessionId: string,
  projectRoot: string
): void {
  if (
    diff.added.length === 0 &&
    diff.deleted.length === 0 &&
    diff.modified.length === 0
  ) {
    return;
  }

  try {
    const relativePath = projectRoot && filePath.startsWith(projectRoot)
      ? filePath.slice(projectRoot.endsWith("/") ? projectRoot.length : projectRoot.length + 1)
      : filePath;

    const addedNames = diff.added.map((s) => s.name);
    const removedNames = diff.deleted.map((s: { name: string }) => s.name);
    const modifiedNames = diff.modified.map((s) => s.new.name);

    const store = new ObservationStore(db);
    store.create({
      sessionId,
      scope: "passive",
      note: `[auto] Modified: ${relativePath} — added: [${addedNames.join(", ")}], removed: [${removedNames.join(", ")}], changed: [${modifiedNames.join(", ")}]`,
      fileId,
      confidence: 0.6,
    });
  } catch (err) {
    log.debug("failed to capture file change observation", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
