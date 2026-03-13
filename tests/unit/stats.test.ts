import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { computeSessionStats } from "../../src/mcp/tools/stats.js";

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

describe("computeSessionStats", () => {
  it("returns zero stats for empty session", () => {
    setupSession("s1");
    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.capsulesGenerated).toBe(0);
    expect(stats.totalTokensBudgeted).toBe(0);
    expect(stats.totalTokensUsed).toBe(0);
    expect(stats.uniqueFiles).toBe(0);
    expect(stats.uniqueSymbols).toBe(0);
    expect(stats.firstPassRate).toBe(0);
    expect(stats.correctionRate).toBe(0);
    expect(stats.budgetUtilization).toBe(0);
    expect(stats.averageFollowUpReads).toBe(0);
  });

  it("aggregates capsule log entries correctly", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "auth middleware", 4000, 2400, ["validateToken", "authGuard"], ["src/auth.ts", "src/guard.ts"], false);
    insertCapsuleLog("s1", "database pool", 4000, 3100, ["getConnection", "Pool"], ["src/db.ts"], true);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.capsulesGenerated).toBe(2);
    expect(stats.totalTokensBudgeted).toBe(8000);
    expect(stats.totalTokensUsed).toBe(5500);
    expect(stats.uniqueFiles).toBe(3);
    expect(stats.uniqueSymbols).toBe(4);
    expect(stats.firstPassRate).toBe(0.5);
    expect(stats.correctionRate).toBe(0.5);
    // budgetUtilization: avg of (2400/4000 + 3100/4000) / 2 = (0.6 + 0.775) / 2 = 0.6875
    expect(stats.budgetUtilization).toBeCloseTo(0.6875, 5);
    // averageFollowUpReads: 1 followedUp out of 2 = 0.5
    expect(stats.averageFollowUpReads).toBeCloseTo(0.5, 5);
  });

  it("budgetUtilization reflects actual token usage ratio", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "auth", 4000, 100, ["fn1"], ["src/a.ts", "src/b.ts", "src/c.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.budgetUtilization).toBeCloseTo(100 / 4000, 5);
    expect((stats as Record<string, unknown>).estimatedRawTokens).toBeUndefined();
    expect((stats as Record<string, unknown>).estimatedSavingsPercent).toBeUndefined();
  });

  it("deduplicates files and symbols across capsules", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "query1", 4000, 2000, ["fn1", "fn2"], ["src/a.ts"]);
    insertCapsuleLog("s1", "query2", 4000, 2000, ["fn2", "fn3"], ["src/a.ts", "src/b.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.uniqueFiles).toBe(2);
    expect(stats.uniqueSymbols).toBe(3);
  });

  it("computes budgetUtilization and averageFollowUpReads correctly", () => {
    setupSession("s1");
    // log1: 2000/4000 = 0.5 utilization, no follow-up
    insertCapsuleLog("s1", "query A", 4000, 2000, ["fnA"], ["src/a.ts"], false);
    // log2: 4000/4000 = 1.0 utilization, followed up
    insertCapsuleLog("s1", "query B", 4000, 4000, ["fnB"], ["src/b.ts"], true);
    // log3: 1000/4000 = 0.25 utilization, no follow-up
    insertCapsuleLog("s1", "query C", 4000, 1000, ["fnC"], ["src/c.ts"], false);

    const stats = computeSessionStats(db, "s1", "/test");
    // budgetUtilization = (0.5 + 1.0 + 0.25) / 3 = 0.5833...
    expect(stats.budgetUtilization).toBeCloseTo((0.5 + 1.0 + 0.25) / 3, 5);
    // averageFollowUpReads = 1 followed-up / 3 total = 0.333...
    expect(stats.averageFollowUpReads).toBeCloseTo(1 / 3, 5);
  });

  it("only counts capsules for the specified session", () => {
    setupSession("s1");
    setupSession("s2");
    insertCapsuleLog("s1", "auth", 4000, 2000, ["fn1"], ["src/a.ts"]);
    insertCapsuleLog("s2", "db", 4000, 3000, ["fn2"], ["src/b.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.capsulesGenerated).toBe(1);
    expect(stats.totalTokensUsed).toBe(2000);
  });
});
