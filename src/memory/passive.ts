import type Database from "better-sqlite3";
import type { IndexDiff } from "../core/types.js";
import { observationQueries } from "../db/queries/observations.js";
import { symbolQueries } from "../db/queries/symbols.js";

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

    const firstSymbol = symbols.getById(pivotArray[0]!);

    observationQueries(db).insert({
      sessionId,
      agentId: "claude-code",
      symbolId: pivotArray[0] ?? null,
      fileId: firstSymbol?.fileId ?? null,
      scope: "passive",
      note: `[auto] Query: "${query}" resolved to: ${names.join(", ")}`,
      confidence: 0.5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
      staleReason: null,
      archived: false,
    });
  } catch {
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

    observationQueries(db).insert({
      sessionId,
      agentId: "claude-code",
      symbolId: null,
      fileId,
      scope: "passive",
      note: `[auto] Modified: ${relativePath} — added: [${addedNames.join(", ")}], removed: [${removedNames.join(", ")}], changed: [${modifiedNames.join(", ")}]`,
      confidence: 0.6,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stale: false,
      staleReason: null,
      archived: false,
    });
  } catch {
  }
}
