import type Database from "better-sqlite3";
import type { IndexDiff } from "../core/types.js";
import { observationQueries } from "../db/queries/observations.js";
import { edgeQueries } from "../db/queries/edges.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { BM25Index } from "./bm25.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("StalenessEngine");

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_CONFIDENCE_DECAY_PER_HOP = 0.3;
const DEFAULT_DECAY_AMOUNT = 0.1;
const DEFAULT_STALE_OLDER_THAN_DAYS = 30;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.1;

type ObsQueries = ReturnType<typeof observationQueries>;
type EdgeQs = ReturnType<typeof edgeQueries>;
type SymQs = ReturnType<typeof symbolQueries>;

interface GCOptions {
  staleOlderThan?: number;
  confidenceThreshold?: number;
  archiveOrphans?: boolean;
}

export class StalenessEngine {
  private readonly queries: ObsQueries;
  private readonly edges: EdgeQs;
  private readonly symbols: SymQs;
  private readonly bm25: BM25Index;

  constructor(db: Database.Database) {
    this.queries = observationQueries(db);
    this.edges = edgeQueries(db);
    this.symbols = symbolQueries(db);
    this.bm25 = new BM25Index(db);
  }

  propagateFromDiff(diff: IndexDiff, fileId: number): void {
    for (const deleted of diff.deleted) {
      this.markDirectObservationsHardStale(deleted.id, "symbol_deleted");
    }

    for (const { old: oldSym } of diff.modified) {
      this.markDirectObservationsHardStale(oldSym.id, "symbol_modified");
      this.propagateSoftStale(oldSym.id, 1, DEFAULT_MAX_DEPTH, new Set([oldSym.id]));
    }

    for (const { old: oldSym, new: newSym } of diff.renamed) {
      const matchingSymbols = this.symbols.getByBodyHash(newSym.bodyHash);
      const newSymRecord = matchingSymbols.find((s) => s.fileId === fileId);
      if (!newSymRecord) continue;

      const observations = this.queries.getBySymbolId(oldSym.id);
      for (const obs of observations) {
        const updated = {
          ...obs,
          symbolId: newSymRecord.id,
          updatedAt: Date.now(),
        };
        this.queries.update(updated);
      }

      logger.debug("Updated observation symbol refs for rename", {
        oldSymbolId: oldSym.id,
        newSymbolId: newSymRecord.id,
        count: observations.length,
      });
    }

    logger.info("Propagated staleness from diff", {
      fileId,
      deleted: diff.deleted.length,
      modified: diff.modified.length,
      renamed: diff.renamed.length,
    });
  }

  private markDirectObservationsHardStale(symbolId: number, reason: string): void {
    const observations = this.queries.getBySymbolId(symbolId);
    for (const obs of observations) {
      if (obs.stale) continue;
      this.queries.markStale(obs.id, reason);
    }
  }

  private propagateSoftStale(
    symbolId: number,
    currentDepth: number,
    maxDepth: number,
    visited: Set<number>
  ): void {
    if (currentDepth > maxDepth) return;

    const dependents = this.edges.getByTarget(symbolId);

    for (const edge of dependents) {
      const depSymId = edge.sourceSymbolId;
      if (visited.has(depSymId)) continue;
      visited.add(depSymId);

      const observations = this.queries.getBySymbolId(depSymId);
      for (const obs of observations) {
        if (obs.stale || obs.archived) continue;
        const decayedConfidence = Math.max(
          0,
          obs.confidence - DEFAULT_CONFIDENCE_DECAY_PER_HOP * currentDepth
        );
        const updated = {
          ...obs,
          confidence: decayedConfidence,
          updatedAt: Date.now(),
        };
        this.queries.update(updated);
      }

      this.propagateSoftStale(depSymId, currentDepth + 1, maxDepth, visited);
    }
  }

  decayConfidence(amount = DEFAULT_DECAY_AMOUNT): void {
    this.queries.decayConfidence(amount);
    logger.info("Decayed confidence for active observations", { amount });
  }

  runGC(options: GCOptions = {}): number {
    const {
      staleOlderThan = Date.now() - DEFAULT_STALE_OLDER_THAN_DAYS * 24 * 60 * 60 * 1000,
      confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
      archiveOrphans = true,
    } = options;

    const expired = this.queries.getExpired(staleOlderThan, confidenceThreshold);
    let archived = 0;

    for (const obs of expired) {
      this.queries.archive(obs.id);
      this.bm25.removeObservation(obs.id);
      archived++;
    }

    if (archiveOrphans) {
      const active = this.queries.getActive();
      for (const obs of active) {
        if (obs.symbolId == null) continue;
        const symbol = this.symbols.getById(obs.symbolId);
        if (symbol) continue;
        this.queries.archive(obs.id);
        this.bm25.removeObservation(obs.id);
        archived++;
      }
    }

    logger.info("GC completed", { archived, staleOlderThan, confidenceThreshold });
    return archived;
  }
}
