import type Database from "better-sqlite3";
import type { ObservationRecord } from "../core/types.js";
import { ObservationStore } from "./observations.js";
import { observationQueries } from "../db/queries/observations.js";
import { countTokens } from "../utils/tokens.js";
import { expandQueryWithSynonyms } from "../utils/synonyms.js";
import { trigramSimilarity } from "../utils/fuzzy.js";
import { loadConfig } from "../utils/config.js";

interface SearchOptions {
  scope?: string;
  includeStale?: boolean;
  includePassive?: boolean;
  limit?: number;
}

interface ScoredObservation {
  observation: ObservationRecord;
  score: number;
}

interface RankedObservation {
  observation: ObservationRecord;
  bm25Score: number;
}

export interface AutoPopulateInput {
  query: string;
  confidence: number;
  filesIncluded: string[];
  symbolsIncluded: string[];
}

const AUTO_POPULATE_CONFIDENCE_THRESHOLD = 0.65;
const RECIPROCAL_RANK_FUSION_K = 60;

const SCOPE_WEIGHTS: Record<string, number> = {
  architecture: 3.0,
  decision: 2.0,
  intent: 2.0,
  pattern: 1.5,
  passive: 0.1,
};

function getScopeWeight(scope: string): number {
  return SCOPE_WEIGHTS[scope] ?? 1.0;
}

function formatObservation(obs: ObservationRecord): string {
  const parts = [`[${obs.scope}] ${obs.note}`];
  if (obs.stale && obs.staleReason) {
    parts.push(`(stale: ${obs.staleReason})`);
  }
  parts.push(`(confidence: ${obs.confidence.toFixed(2)})`);
  return parts.join(" ");
}

/**
 * Return true when query has >3 words with no camelCase or snake_case — i.e.
 * a natural-language broad query that benefits from synonym expansion + OR logic.
 */
function isBroadNaturalQuery(query: string): boolean {
  const words = query.trim().split(/\s+/);
  if (words.length <= 3) return false;
  const hasCamelCase = /[a-z][A-Z]/.test(query);
  const hasSnakeCase = /[a-z]_[a-z]/.test(query);
  return !hasCamelCase && !hasSnakeCase;
}

export class MemorySearch {
  private readonly store: ObservationStore;
  private readonly db: Database.Database;
  private readonly passiveTtlMs: number;
  private stmtCheckExisting: Database.Statement | null = null;
  private stmtLatestSession: Database.Statement | null = null;

  constructor(db: Database.Database) {
    this.store = new ObservationStore(db);
    this.db = db;
    this.passiveTtlMs = this.resolvePassiveTtlMs();
  }

  hasObservations(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM observations WHERE archived = 0").get() as { count: number };
    return row.count > 0;
  }

  ensureBm25Consistent(): void {
    this.store.rebuildBm25IfEmpty();
  }

  autoPopulateFromCapsule(input: AutoPopulateInput): void {
    if (input.confidence < AUTO_POPULATE_CONFIDENCE_THRESHOLD) return;

    const fileList = input.filesIncluded.slice(0, 5).join(", ");
    if (!fileList) return;

    const scope = "passive";
    const symbolSuffix = input.symbolsIncluded.length > 0
      ? `; symbols: ${input.symbolsIncluded.slice(0, 4).join(", ")}`
      : "";
    const note = `capsule for "${input.query}" included: ${fileList}${symbolSuffix}`;

    this.stmtCheckExisting ??= this.db.prepare("SELECT id FROM observations WHERE note = ? AND archived = 0 LIMIT 1");
    const existing = this.stmtCheckExisting.get(note);
    if (existing) return;

    this.stmtLatestSession ??= this.db.prepare("SELECT id FROM sessions ORDER BY started_at DESC LIMIT 1");
    const sessionRow = this.stmtLatestSession.get() as { id: string } | undefined;
    if (!sessionRow) return;

    const now = Date.now();
    observationQueries(this.db).insert({
      sessionId: sessionRow.id,
      agentId: "capsule-auto",
      symbolId: null,
      fileId: null,
      scope,
      note,
      confidence: Math.min(input.confidence, 0.6),
      createdAt: now,
      updatedAt: now,
      stale: false,
      staleReason: null,
      archived: false,
    });
  }

  private buildExpandedQuery(query: string): string {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const expanded = expandQueryWithSynonyms(terms);
    return expanded.join(" ");
  }

  private getAllActiveObservations(): ObservationRecord[] {
    return observationQueries(this.db).getActive().slice(0, 500);
  }

  private resolvePassiveTtlMs(): number {
    const sessionRow = this.db
      .prepare("SELECT project_root FROM sessions ORDER BY started_at DESC LIMIT 1")
      .get() as { project_root: string | null } | undefined;

    const projectRoot = sessionRow?.project_root;
    if (!projectRoot) return 7 * 24 * 60 * 60 * 1000;

    return loadConfig(projectRoot).passiveTtlDays * 24 * 60 * 60 * 1000;
  }

  private isExpiredPassive(obs: ObservationRecord): boolean {
    return obs.scope === "passive" && Date.now() - obs.updatedAt > this.passiveTtlMs;
  }

  private fuzzyFallbackSearch(
    query: string,
    options: SearchOptions,
    limit: number
  ): ScoredObservation[] {
    const { scope, includeStale = false, includePassive = true } = options;
    const allObs = this.getAllActiveObservations();
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length >= 3);
    const expandedTerms = expandQueryWithSynonyms(queryTerms);
    const scored: ScoredObservation[] = [];

    for (const obs of allObs) {
      if (!includeStale && obs.stale) continue;
      if (this.isExpiredPassive(obs)) continue;
      if (scope !== undefined && obs.scope !== scope) continue;
      if (!includePassive && obs.scope === "passive") continue;

      const noteLower = obs.note.toLowerCase();
      let textScore = 0;
      if (noteLower.includes(queryLower)) {
        textScore = 0.9;
      } else {
        const matchingTerms = expandedTerms.filter((t) => noteLower.includes(t));
        if (matchingTerms.length > 0) {
          textScore = Math.min(0.8, 0.3 + matchingTerms.length * 0.15);
        } else {
          textScore = trigramSimilarity(query, obs.note);
        }
      }

      if (textScore < 0.15) continue;
      const combinedScore = obs.confidence * textScore * getScopeWeight(obs.scope);
      scored.push({ observation: obs, score: combinedScore });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  private fuseRankedResults(
    porterResults: RankedObservation[],
    trigramResults: RankedObservation[],
    limit: number
  ): RankedObservation[] {
    if (porterResults.length === 0) return trigramResults.slice(0, limit);
    if (trigramResults.length === 0) return porterResults.slice(0, limit);

    const merged = new Map<number, RankedObservation>();
    const rrfScores = new Map<number, number>();

    const addRankedResults = (results: RankedObservation[]) => {
      for (const [index, result] of results.entries()) {
        const rrfScore = 1 / (RECIPROCAL_RANK_FUSION_K + index + 1);
        const observationId = result.observation.id;

        if (!merged.has(observationId)) {
          merged.set(observationId, result);
        }
        rrfScores.set(observationId, (rrfScores.get(observationId) ?? 0) + rrfScore);
      }
    };

    addRankedResults(porterResults);
    addRankedResults(trigramResults);

    return [...merged.values()]
      .map((result) => ({
        observation: result.observation,
        bm25Score: rrfScores.get(result.observation.id) ?? 0,
      }))
      .sort((a, b) => b.bm25Score - a.bm25Score)
      .slice(0, limit);
  }

  private runRrfSearch(query: string, limit: number): RankedObservation[] {
    const porterResults = this.store.searchPorterWithScores(query, limit);
    const trigramResults = this.store.searchTrigramWithScores(query, limit);
    return this.fuseRankedResults(porterResults, trigramResults, limit);
  }

  /**
   * For broad natural-language queries: run multiple synonym-expanded sub-queries
   * and merge with OR logic (union of all result sets, deduplicated).
   */
  private broadOrSearch(query: string, limit: number): Array<{ observation: ObservationRecord; bm25Score: number }> {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

    // Run the full expanded query first
    const expandedTerms = expandQueryWithSynonyms(terms);
    const expandedQuery = expandedTerms.join(" ");

    const results = this.runRrfSearch(expandedQuery, limit * 3);

    // Also run each original term individually to maximise OR coverage
    const seen = new Map<number, { observation: ObservationRecord; bm25Score: number }>();
    for (const r of results) {
      seen.set(r.observation.id, r);
    }

    for (const term of terms) {
      if (term.length < 4) continue;
      const termResults = this.runRrfSearch(term, limit);
      for (const r of termResults) {
        if (!seen.has(r.observation.id)) {
          seen.set(r.observation.id, r);
        }
      }
    }

    return [...seen.values()];
  }

  search(query: string, options: SearchOptions = {}): ScoredObservation[] {
    const { scope, includeStale = false, includePassive = true, limit = 20 } = options;

    const isBroad = isBroadNaturalQuery(query);

    let rawResults: Array<{ observation: ObservationRecord; bm25Score: number }>;

    if (isBroad) {
      rawResults = this.broadOrSearch(query, limit);
    } else {
      const expandedQuery = this.buildExpandedQuery(query);
      rawResults = this.runRrfSearch(expandedQuery, limit * 3);

      if (expandedQuery !== query.toLowerCase()) {
        const supplemental = this.runRrfSearch(query, limit * 2);
        rawResults = this.fuseRankedResults(rawResults, supplemental, limit * 3);
      }
    }

    const scored: ScoredObservation[] = [];

    for (const { observation: obs, bm25Score } of rawResults) {
      if (!includeStale && obs.stale) continue;
      if (this.isExpiredPassive(obs)) continue;
      if (scope !== undefined && obs.scope !== scope) continue;
      if (!includePassive && obs.scope === "passive") continue;

      const combinedScore = obs.confidence * bm25Score * getScopeWeight(obs.scope);
      scored.push({ observation: obs, score: combinedScore });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit);

    if (results.length === 0) {
      return this.fuzzyFallbackSearch(query, options, limit);
    }

    return results;
  }

  getRelevantForCapsule(
    query: string,
    budget: number
  ): { observations: ObservationRecord[]; formatted: string; tokensUsed: number } {
    const results = this.search(query, { includePassive: false, limit: 50 });

    const selected: ObservationRecord[] = [];
    let tokensUsed = 0;

    for (const { observation } of results) {
      const text = formatObservation(observation);
      const tokens = countTokens(text);
      if (tokensUsed + tokens > budget) break;
      selected.push(observation);
      tokensUsed += tokens;
    }

    const formatted = selected.map(formatObservation).join("\n");

    return { observations: selected, formatted, tokensUsed };
  }
}
