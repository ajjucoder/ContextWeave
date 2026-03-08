import type Database from "better-sqlite3";
import type { CapsuleLogRecord, CapsuleMode } from "../../core/types.js";

type CapsuleLogQueriesResult = ReturnType<typeof capsuleLogQueriesImpl>;
const capsuleLogQueriesCache = new WeakMap<Database.Database, CapsuleLogQueriesResult>();

export function capsuleLogQueries(db: Database.Database): CapsuleLogQueriesResult {
  const cached = capsuleLogQueriesCache.get(db);
  if (cached) return cached;
  const result = capsuleLogQueriesImpl(db);
  capsuleLogQueriesCache.set(db, result);
  return result;
}

function capsuleLogQueriesImpl(db: Database.Database) {
  const insert = db.prepare(`
    INSERT INTO capsule_log (session_id, query, mode, token_budget, tokens_used, symbols_included, files_included, timestamp, followed_up, miss_ratio, noise_ratio)
    VALUES (@sessionId, @query, @mode, @tokenBudget, @tokensUsed, @symbolsIncluded, @filesIncluded, @timestamp, @followedUp, @missRatio, @noiseRatio)
  `);

  const getBySession = db.prepare("SELECT * FROM capsule_log WHERE session_id = ? ORDER BY id DESC");
  const getBySessionAndQuery = db.prepare("SELECT * FROM capsule_log WHERE session_id = ? AND query = ? ORDER BY id DESC LIMIT 1");
  const getLatestBySession = db.prepare("SELECT * FROM capsule_log WHERE session_id = ? ORDER BY id DESC LIMIT 1");
  const getLatestByProjectRoot = db.prepare(`
    SELECT capsule_log.*
    FROM capsule_log
    JOIN sessions ON sessions.id = capsule_log.session_id
    WHERE sessions.project_root = ?
    ORDER BY capsule_log.id DESC
    LIMIT 1
  `);
  const getLatest = db.prepare("SELECT * FROM capsule_log ORDER BY id DESC LIMIT 1");
  const getRecent = db.prepare("SELECT * FROM capsule_log ORDER BY id DESC LIMIT ?");
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
      symbolsIncluded: (() => { try { return JSON.parse(r["symbols_included"] as string) as string[]; } catch { return []; } })(),
      filesIncluded: (() => { try { return JSON.parse(r["files_included"] as string) as string[]; } catch { return []; } })(),
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

    getBySessionAndQuery(sessionId: string, query: string): CapsuleLogRecord | undefined {
      return mapRow(getBySessionAndQuery.get(sessionId, query));
    },

    getLatestBySession(sessionId: string): CapsuleLogRecord | undefined {
      return mapRow(getLatestBySession.get(sessionId));
    },

    getLatestByProjectRoot(projectRoot: string): CapsuleLogRecord | undefined {
      return mapRow(getLatestByProjectRoot.get(projectRoot));
    },

    getLatest(): CapsuleLogRecord | undefined {
      return mapRow(getLatest.get());
    },

    getRecent(limit: number): CapsuleLogRecord[] {
      return (getRecent.all(limit) as unknown[]).map(mapRow).filter(Boolean) as CapsuleLogRecord[];
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
