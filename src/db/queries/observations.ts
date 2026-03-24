import type Database from "better-sqlite3";
import type { ObservationRecord } from "../../core/types.js";
import { validateRow, type RowSchema } from "./row-validator.js";

type ObservationQueriesResult = ReturnType<typeof observationQueriesImpl>;
const observationQueriesCache = new WeakMap<Database.Database, ObservationQueriesResult>();

type RawObservationRow = {
  id: number;
  session_id: string;
  agent_id: string;
  symbol_id: number | null;
  file_id: number | null;
  scope: string;
  note: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  stale: number;
  stale_reason: string | null;
  archived: number;
};

const isNullableNumber = (value: unknown): value is number | null => value === null || typeof value === "number";
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const isRowBoolean = (value: unknown): value is number => value === 0 || value === 1;

const observationRowSchema: RowSchema<RawObservationRow> = {
  id: (value): value is number => typeof value === "number",
  session_id: (value): value is string => typeof value === "string",
  agent_id: (value): value is string => typeof value === "string",
  symbol_id: isNullableNumber,
  file_id: isNullableNumber,
  scope: (value): value is string => typeof value === "string",
  note: (value): value is string => typeof value === "string",
  confidence: (value): value is number => typeof value === "number",
  created_at: (value): value is number => typeof value === "number",
  updated_at: (value): value is number => typeof value === "number",
  stale: isRowBoolean,
  stale_reason: isNullableString,
  archived: isRowBoolean,
};

export function observationQueries(db: Database.Database): ObservationQueriesResult {
  const cached = observationQueriesCache.get(db);
  if (cached) return cached;
  const result = observationQueriesImpl(db);
  observationQueriesCache.set(db, result);
  return result;
}

function observationQueriesImpl(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO observations (session_id, agent_id, symbol_id, file_id, scope, note, confidence, created_at, updated_at, stale, stale_reason, archived)
    VALUES (@sessionId, @agentId, @symbolId, @fileId, @scope, @note, @confidence, @createdAt, @updatedAt, @stale, @staleReason, @archived)
  `);

  const update = db.prepare(`
    UPDATE observations SET note = @note, confidence = @confidence, updated_at = @updatedAt, stale = @stale, stale_reason = @staleReason, archived = @archived
    WHERE id = @id
  `);

  const getById = db.prepare("SELECT * FROM observations WHERE id = ?");
  const getBySymbolId = db.prepare("SELECT * FROM observations WHERE symbol_id = ? AND archived = 0");
  const getByFileId = db.prepare("SELECT * FROM observations WHERE file_id = ? AND archived = 0");
  const getByScope = db.prepare("SELECT * FROM observations WHERE scope = ? AND archived = 0");
  const getActive = db.prepare("SELECT * FROM observations WHERE stale = 0 AND archived = 0 ORDER BY confidence DESC LIMIT 10000");
  const getStale = db.prepare("SELECT * FROM observations WHERE stale = 1 AND archived = 0 LIMIT 10000");
  const getBySession = db.prepare("SELECT * FROM observations WHERE session_id = ? AND archived = 0");
  const markStale = db.prepare("UPDATE observations SET stale = 1, stale_reason = ?, updated_at = ? WHERE id = ?");
  const archive = db.prepare("UPDATE observations SET archived = 1, updated_at = ? WHERE id = ?");
  const decayConfidence = db.prepare("UPDATE observations SET confidence = MAX(0, confidence - ?), updated_at = ? WHERE archived = 0 AND stale = 0");
  const getExpired = db.prepare("SELECT * FROM observations WHERE (stale = 1 AND updated_at < ?) OR (confidence < ? AND archived = 0)");
  const countAll = db.prepare("SELECT COUNT(*) as count FROM observations WHERE archived = 0");
  const countStale = db.prepare("SELECT COUNT(*) as count FROM observations WHERE stale = 1 AND archived = 0");

  function mapRow(row: unknown): ObservationRecord | undefined {
    const r = validateRow(row, observationRowSchema);
    if (!r) return undefined;
    return {
      id: r.id,
      sessionId: r.session_id,
      agentId: r.agent_id,
      symbolId: r.symbol_id,
      fileId: r.file_id,
      scope: r.scope,
      note: r.note,
      confidence: r.confidence,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      stale: r.stale === 1,
      staleReason: r.stale_reason,
      archived: r.archived === 1,
    };
  }

  return {
    insert(obs: Omit<ObservationRecord, "id">): number {
      const result = insert.run({
        sessionId: obs.sessionId,
        agentId: obs.agentId,
        symbolId: obs.symbolId,
        fileId: obs.fileId,
        scope: obs.scope,
        note: obs.note,
        confidence: obs.confidence,
        createdAt: obs.createdAt,
        updatedAt: obs.updatedAt,
        stale: obs.stale ? 1 : 0,
        staleReason: obs.staleReason,
        archived: obs.archived ? 1 : 0,
      });
      return Number(result.lastInsertRowid);
    },

    update(obs: ObservationRecord): void {
      update.run({
        id: obs.id,
        note: obs.note,
        confidence: obs.confidence,
        updatedAt: obs.updatedAt,
        stale: obs.stale ? 1 : 0,
        staleReason: obs.staleReason,
        archived: obs.archived ? 1 : 0,
      });
    },

    getById(id: number): ObservationRecord | undefined {
      return mapRow(getById.get(id));
    },

    getBySymbolId(symbolId: number): ObservationRecord[] {
      return getBySymbolId.all(symbolId).map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    getByFileId(fileId: number): ObservationRecord[] {
      return getByFileId.all(fileId).map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    getByScope(scope: string): ObservationRecord[] {
      return getByScope.all(scope).map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    getActive(): ObservationRecord[] {
      return getActive.all().map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    getStale(): ObservationRecord[] {
      return getStale.all().map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    getBySession(sessionId: string): ObservationRecord[] {
      return getBySession.all(sessionId).map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    markStale(id: number, reason: string): void {
      markStale.run(reason, Date.now(), id);
    },

    archive(id: number): void {
      archive.run(Date.now(), id);
    },

    decayConfidence(amount: number): void {
      decayConfidence.run(amount, Date.now());
    },

    getExpired(staleOlderThan: number, confidenceThreshold: number): ObservationRecord[] {
      return getExpired.all(staleOlderThan, confidenceThreshold).map(mapRow).filter(Boolean) as ObservationRecord[];
    },

    count(): number {
      return (countAll.get() as { count: number }).count;
    },

    countStale(): number {
      return (countStale.get() as { count: number }).count;
    },
  };
}
