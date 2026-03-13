import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { computeSessionStats, formatRatePct } from "../../src/mcp/tools/stats.js";

let db: Database.Database;

function setupSession(sessionId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, "claude-code", "/test", Date.now() - 60000);
}

function insertCapsuleLog(
  sessionId: string,
  query: string,
  budget: number,
  used: number,
  symbols: string[],
  files: string[],
  followedUp = false
): void {
  db.prepare(`
    INSERT INTO capsule_log (session_id, query, mode, token_budget, tokens_used, symbols_included, files_included, timestamp, followed_up, miss_ratio, noise_ratio)
    VALUES (?, ?, 'feature', ?, ?, ?, ?, ?, ?, NULL, NULL)
  `).run(sessionId, query, budget, used, JSON.stringify(symbols), JSON.stringify(files), Date.now(), followedUp ? 1 : 0);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("stats honesty — factual metrics only, no misleading savings claims", () => {
  it("does not expose estimatedSavingsPercent or estimatedRawTokens", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "auth", 8000, 6000, ["fn1", "fn2"], ["src/a.ts"]);

    const stats = computeSessionStats(db, "s1");
    expect((stats as Record<string, unknown>).estimatedSavingsPercent).toBeUndefined();
    expect((stats as Record<string, unknown>).estimatedRawTokens).toBeUndefined();
  });

  it("budgetUtilization is displayed in stats", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "auth", 4000, 2000, ["fn1"], ["src/a.ts"], false);
    insertCapsuleLog("s1", "db", 4000, 3000, ["fn2"], ["src/b.ts"], false);

    const stats = computeSessionStats(db, "s1");
    expect(stats.budgetUtilization).toBeGreaterThan(0);
    expect(stats.budgetUtilization).toBeLessThanOrEqual(1);
    const utilizationStr = formatRatePct(stats.budgetUtilization);
    expect(utilizationStr).toMatch(/^\d+\.\d+%$/);
  });

  it("reports accurate token metrics without % reduction headline", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "q1", 8000, 3500, ["fn1", "fn2"], ["a.ts", "b.ts"]);
    insertCapsuleLog("s1", "q2", 8000, 4200, ["fn3"], ["c.ts"]);

    const stats = computeSessionStats(db, "s1");
    expect(stats.capsulesGenerated).toBe(2);
    expect(stats.totalTokensUsed).toBe(7700);
    expect(stats.totalTokensBudgeted).toBe(16000);
    expect(stats.uniqueFiles).toBe(3);
  });

  it("budgetUtilization is calculated correctly as average per capsule", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "q1", 4000, 200, ["fn1"], ["a.ts", "b.ts", "c.ts", "d.ts"]);

    const stats = computeSessionStats(db, "s1");
    expect(stats.budgetUtilization).toBeCloseTo(200 / 4000, 5);
  });
});
