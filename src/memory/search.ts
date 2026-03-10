import type Database from "better-sqlite3";
import type { ObservationRecord } from "../core/types.js";
import { ObservationStore } from "./observations.js";
import { observationQueries } from "../db/queries/observations.js";
import { countTokens } from "../utils/tokens.js";
import { expandQueryWithSynonyms } from "../utils/synonyms.js";
import { trigramSimilarity } from "../utils/fuzzy.js";

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

const PASSIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SCOPE_WEIGHTS: Record<string, number> = {
  architecture: 3.0,
  decision: 2.0,
  intent: 2.0,
  pattern: 1.5,
  passive: 0.3,
};

function getScopeWeight(scope: string): number {
  return SCOPE_WEIGHTS[scope] ?? 1.0;
}

function isExpiredPassive(obs: ObservationRecord): boolean {
  return obs.scope === "passive" && Date.now() - obs.updatedAt > PASSIVE_TTL_MS;
}

function formatObservation(obs: ObservationRecord): string {
  const parts = [`[${obs.scope}] ${obs.note}`];
  if (obs.stale && obs.staleReason) {
    parts.push(`(stale: ${obs.staleReason})`);
  }
  parts.push(`(confidence: ${obs.confidence.toFixed(2)})`);
  return parts.join(" ");
}

export class MemorySearch {
  private readonly store: ObservationStore;
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.store = new ObservationStore(db);
    this.db = db;
  }

  hasObservations(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM observations WHERE archived = 0").get() as { count: number };
    return row.count > 0;
  }

  ensureBm25Consistent(): void {
    this.store.rebuildBm25IfEmpty();
  }

  private isBroadQuery(query: string): boolean {
    const words = query.trim().split(/\s+/);
    if (words.length <= 3) return false;
    const hasCamelCase = /[a-z][A-Z]/.test(query);
    const hasSnakeCase = /[a-z]_[a-z]/.test(query);
    return !hasCamelCase && !hasSnakeCase;
  }

  private buildExpandedQuery(query: string): string {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const expanded = expandQueryWithSynonyms(terms);
    return expanded.join(" ");
  }

  private getAllActiveObservations(): ObservationRecord[] {
    return observationQueries(this.db).getActive().slice(0, 500);
  }

  private fuzzyFallbackSearch(
    query: string,
    options: SearchOptions,
    limit: number
  ): ScoredObservation[] {
    const { scope, includeStale = false, includePassive = true } = options;
    const allObs = this.getAllActiveObservations();
    const queryLower = query.toLowerCase();
    const scored: ScoredObservation[] = [];

    for (const obs of allObs) {
      if (!includeStale && obs.stale) continue;
      if (isExpiredPassive(obs)) continue;
      if (scope !== undefined && obs.scope !== scope) continue;
      if (!includePassive && obs.scope === "passive") continue;

      const noteLower = obs.note.toLowerCase();
      let textScore = 0;
      if (noteLower.includes(queryLower)) {
        textScore = 0.9;
      } else {
        textScore = trigramSimilarity(query, obs.note);
      }

      if (textScore < 0.2) continue;
      const combinedScore = obs.confidence * textScore * getScopeWeight(obs.scope);
      scored.push({ observation: obs, score: combinedScore });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  search(query: string, options: SearchOptions = {}): ScoredObservation[] {
    const { scope, includeStale = false, includePassive = true, limit = 20 } = options;

    const expandedQuery = this.buildExpandedQuery(query);
    const isBroad = this.isBroadQuery(query);
    const searchQuery = isBroad ? expandedQuery : query;

    const rawResults = this.store.searchWithScores(searchQuery, limit * 3);

    const supplemental =
      isBroad && expandedQuery !== query.toLowerCase()
        ? this.store.searchWithScores(query, limit * 2)
        : [];

    const merged = new Map<number, { observation: ObservationRecord; bm25Score: number }>();
    for (const item of rawResults) {
      merged.set(item.observation.id, item);
    }
    for (const item of supplemental) {
      if (!merged.has(item.observation.id)) {
        merged.set(item.observation.id, item);
      }
    }

    const scored: ScoredObservation[] = [];

    for (const { observation: obs, bm25Score } of merged.values()) {
      if (!includeStale && obs.stale) continue;
      if (isExpiredPassive(obs)) continue;
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
