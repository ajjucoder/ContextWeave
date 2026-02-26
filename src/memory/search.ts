import type Database from "better-sqlite3";
import type { ObservationRecord } from "../core/types.js";
import { ObservationStore } from "./observations.js";
import { countTokens } from "../utils/tokens.js";

interface SearchOptions {
  scope?: string;
  includeStale?: boolean;
  limit?: number;
}

interface ScoredObservation {
  observation: ObservationRecord;
  score: number;
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
    const { scope, includeStale = false, limit = 20 } = options;

    const rawResults = this.store.searchWithScores(query, limit * 3);

    const scored: ScoredObservation[] = [];

    for (const { observation: obs, bm25Score } of rawResults) {
      if (!includeStale && obs.stale) continue;
      if (scope !== undefined && obs.scope !== scope) continue;

      const combinedScore = obs.confidence * bm25Score;
      scored.push({ observation: obs, score: combinedScore });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  getRelevantForCapsule(
    query: string,
    budget: number
  ): { observations: ObservationRecord[]; formatted: string; tokensUsed: number } {
    const results = this.search(query, { limit: 50 });

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
