import type Database from "better-sqlite3";
import type { ObservationRecord } from "../core/types.js";
import { ObservationStore } from "./observations.js";
import { countTokens } from "../utils/tokens.js";

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

  constructor(db: Database.Database) {
    this.store = new ObservationStore(db);
  }

  search(query: string, options: SearchOptions = {}): ScoredObservation[] {
    const { scope, includeStale = false, includePassive = true, limit = 20 } = options;

    const rawResults = this.store.searchWithScores(query, limit * 3);

    const scored: ScoredObservation[] = [];

    for (const { observation: obs, bm25Score } of rawResults) {
      if (!includeStale && obs.stale) continue;
      if (isExpiredPassive(obs)) continue;
      if (scope !== undefined && obs.scope !== scope) continue;
      if (!includePassive && obs.scope === "passive") continue;

      const combinedScore = obs.confidence * bm25Score * getScopeWeight(obs.scope);
      scored.push({ observation: obs, score: combinedScore });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
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
