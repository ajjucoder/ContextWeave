import type Database from "better-sqlite3";
import type { CapsuleLogRecord, CapsuleMode } from "../../core/types.js";

export function capsuleLogQueries(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO capsule_log (session_id, query, mode, token_budget, tokens_used, symbols_included, files_included, timestamp, followed_up, miss_ratio, noise_ratio)
    VALUES (@sessionId, @query, @mode, @tokenBudget, @tokensUsed, @symbolsIncluded, @filesIncluded, @timestamp, @followedUp, @missRatio, @noiseRatio)
  `);

  const getBySession = db.prepare("SELECT * FROM capsule_log WHERE session_id = ? ORDER BY timestamp DESC");
  const getLatest = db.prepare("SELECT * FROM capsule_log ORDER BY timestamp DESC LIMIT 1");
  const updateFeedback = db.prepare(
    "UPDATE capsule_log SET followed_up = @followedUp, miss_ratio = @missRatio, noise_ratio = @noiseRatio WHERE id = @id"
  );

  function mapRow(row: unknown): CapsuleLogRecord | undefined {
    if (!row) return undefined;
    const r = row as Record<string, unknown>;
    return {
      id: r["id"] as number,
      sessionId: r["session_id"] as string,
      query: r["query"] as string,
      mode: r["mode"] as CapsuleMode,
      tokenBudget: r["token_budget"] as number,
      tokensUsed: r["tokens_used"] as number,
      symbolsIncluded: JSON.parse(r["symbols_included"] as string) as string[],
      filesIncluded: JSON.parse(r["files_included"] as string) as string[],
      timestamp: r["timestamp"] as number,
      followedUp: (r["followed_up"] as number) === 1,
      missRatio: r["miss_ratio"] as number | null,
      noiseRatio: r["noise_ratio"] as number | null,
    };
  }

  return {
    insert(log: Omit<CapsuleLogRecord, "id">): number {
      const result = insert.run({
        sessionId: log.sessionId,
        query: log.query,
        mode: log.mode,
        tokenBudget: log.tokenBudget,
        tokensUsed: log.tokensUsed,
        symbolsIncluded: JSON.stringify(log.symbolsIncluded),
        filesIncluded: JSON.stringify(log.filesIncluded),
        timestamp: log.timestamp,
        followedUp: log.followedUp ? 1 : 0,
        missRatio: log.missRatio,
        noiseRatio: log.noiseRatio,
      });
      return Number(result.lastInsertRowid);
    },

    getBySession(sessionId: string): CapsuleLogRecord[] {
      return getBySession.all(sessionId).map(mapRow).filter(Boolean) as CapsuleLogRecord[];
    },

    getLatest(): CapsuleLogRecord | undefined {
      return mapRow(getLatest.get());
    },

    updateFeedback(id: number, followedUp: boolean, missRatio: number | null, noiseRatio: number | null): void {
      updateFeedback.run({
        id,
        followedUp: followedUp ? 1 : 0,
        missRatio,
        noiseRatio,
      });
    },
  };
}
