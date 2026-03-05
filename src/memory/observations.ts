import type Database from "better-sqlite3";
import type { ObservationRecord } from "../core/types.js";
import { observationQueries } from "../db/queries/observations.js";
import { BM25Index } from "./bm25.js";
import { symbolQueries } from "../db/queries/symbols.js";

type ObservationQueries = ReturnType<typeof observationQueries>;
type SymbolQueries = ReturnType<typeof symbolQueries>;

interface CreateParams {
  sessionId: string;
  agentId?: string;
  symbolId?: number;
  fileId?: number;
  scope: string;
  note: string;
  confidence?: number;
}

interface UpdateParams {
  note?: string;
  confidence?: number;
  stale?: boolean;
  staleReason?: string | null;
}

interface SearchOptions {
  scope?: string;
  includeStale?: boolean;
  limit?: number;
}

export class ObservationStore {
  private readonly queries: ObservationQueries;
  private readonly symbols: SymbolQueries;
  private readonly bm25: BM25Index;

  constructor(db: Database.Database) {
    this.queries = observationQueries(db);
    this.symbols = symbolQueries(db);
    this.bm25 = new BM25Index(db);
  }

  create(params: CreateParams): ObservationRecord {
    const now = Date.now();
    const id = this.queries.insert({
      sessionId: params.sessionId,
      agentId: params.agentId ?? "claude-code",
      symbolId: params.symbolId ?? null,
      fileId: params.fileId ?? null,
      scope: params.scope,
      note: params.note,
      confidence: params.confidence ?? 1.0,
      createdAt: now,
      updatedAt: now,
      stale: false,
      staleReason: null,
      archived: false,
    });

    let indexText = params.note + " " + params.scope;
    if (params.symbolId != null) {
      const symbol = this.symbols.getById(params.symbolId);
      if (symbol) {
        indexText += " " + symbol.name;
      }
    }

    this.bm25.indexObservation(id, indexText);

    const record = this.queries.getById(id);
    if (!record) throw new Error(`Failed to retrieve created observation ${id}`);
    return record;
  }

  update(id: number, updates: UpdateParams): ObservationRecord | undefined {
    const existing = this.queries.getById(id);
    if (!existing) return undefined;

    const updated: ObservationRecord = {
      ...existing,
      confidence: updates.confidence ?? existing.confidence,
      stale: updates.stale ?? existing.stale,
      staleReason: updates.staleReason !== undefined ? updates.staleReason : existing.staleReason,
      note: updates.note ?? existing.note,
      updatedAt: Date.now(),
    };

    this.queries.update(updated);

    if (updates.note !== undefined) {
      let indexText = updated.note + " " + updated.scope;
      if (updated.symbolId != null) {
        const symbol = this.symbols.getById(updated.symbolId);
        if (symbol) {
          indexText += " " + symbol.name;
        }
      }
      this.bm25.removeObservation(id);
      this.bm25.indexObservation(id, indexText);
    }

    return this.queries.getById(id);
  }

  getBySymbol(symbolId: number): ObservationRecord[] {
    return this.queries.getBySymbolId(symbolId);
  }

  getByFile(fileId: number): ObservationRecord[] {
    return this.queries.getByFileId(fileId);
  }

  getByScope(scope: string): ObservationRecord[] {
    return this.queries.getByScope(scope);
  }

  search(query: string, options: SearchOptions = {}): ObservationRecord[] {
    const { scope, includeStale = false, limit = 20 } = options;

    const bm25Results = this.bm25.searchWithFallback(query, limit * 3);

    const results: ObservationRecord[] = [];

    for (const { observationId } of bm25Results) {
      const obs = this.queries.getById(observationId);
      if (!obs) continue;
      if (obs.archived) continue;
      if (!includeStale && obs.stale) continue;
      if (scope !== undefined && obs.scope !== scope) continue;
      results.push(obs);
      if (results.length >= limit) break;
    }

    return results;
  }

  searchWithScores(
    query: string,
    limit = 20
  ): Array<{ observation: ObservationRecord; bm25Score: number }> {
    const bm25Results = this.bm25.searchWithFallback(query, limit);

    const results: Array<{ observation: ObservationRecord; bm25Score: number }> = [];

    for (const { observationId, score } of bm25Results) {
      const obs = this.queries.getById(observationId);
      if (!obs || obs.archived) continue;
      results.push({ observation: obs, bm25Score: score });
    }

    return results;
  }
}
