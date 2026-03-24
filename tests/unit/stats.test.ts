import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { computeSessionStats, formatStats } from "../../src/mcp/tools/stats.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { edgeQueries } from "../../src/db/queries/edges.js";

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

function insertCycleGraph(): void {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();
  const fileId = files.insert({
    path: "src/cycle.ts",
    hash: "cycle-hash",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 0,
    error: null,
  });

  const ids = ["A", "B", "C"].map((name) => symbols.insert({
    fileId,
    name,
    kind: "function",
    startLine: 1,
    endLine: 1,
    signature: `function ${name}()`,
    bodyHash: `${name}-hash`,
    fullSource: `function ${name}() {}`,
    isExported: true,
    docComment: null,
    centrality: 0,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: null,
  }));

  edges.insert({ sourceSymbolId: ids[0]!, targetSymbolId: ids[1]!, kind: "call", createdAt: now });
  edges.insert({ sourceSymbolId: ids[1]!, targetSymbolId: ids[2]!, kind: "call", createdAt: now });
  edges.insert({ sourceSymbolId: ids[2]!, targetSymbolId: ids[0]!, kind: "call", createdAt: now });
}

function insertQualityFixtures(): void {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const now = Date.now();
  const fileId = files.insert({
    path: "src/quality.ts",
    hash: "quality-hash",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 0,
    error: null,
  });

  const aliveId = symbols.insert({
    fileId,
    name: "aliveHelper",
    kind: "function",
    startLine: 1,
    endLine: 20,
    signature: "function aliveHelper()",
    bodyHash: "alive-hash",
    fullSource: "function aliveHelper() {}",
    isExported: false,
    docComment: null,
    centrality: 0,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: null,
  });

  const callerId = symbols.insert({
    fileId,
    name: "callAliveHelper",
    kind: "function",
    startLine: 22,
    endLine: 40,
    signature: "function callAliveHelper()",
    bodyHash: "caller-hash",
    fullSource: "function callAliveHelper() { return aliveHelper(); }",
    isExported: true,
    docComment: null,
    centrality: 0,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: null,
  });

  const deadId = symbols.insert({
    fileId,
    name: "deadHelper",
    kind: "function",
    startLine: 42,
    endLine: 58,
    signature: "function deadHelper()",
    bodyHash: "dead-hash",
    fullSource: "function deadHelper() {}",
    isExported: false,
    docComment: null,
    centrality: 0,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: null,
  });

  const largeId = symbols.insert({
    fileId,
    name: "giantHandler",
    kind: "function",
    startLine: 60,
    endLine: 180,
    signature: "function giantHandler()",
    bodyHash: "large-hash",
    fullSource: "function giantHandler() {}",
    isExported: true,
    docComment: null,
    centrality: 0,
    lastSeen: now,
    parentSymbolId: null,
    qualifiedName: null,
  });

  edges.insert({ sourceSymbolId: callerId, targetSymbolId: aliveId, kind: "call", createdAt: now });
  // Self-call should still count as incoming and keep the helper from being marked dead.
  edges.insert({ sourceSymbolId: largeId, targetSymbolId: largeId, kind: "call", createdAt: now });

  expect(deadId).toBeGreaterThan(0);
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
    expect(stats.circularDependencyClusters).toBe(0);
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
    expect(stats.circularDependencyClusters).toBe(0);
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

  it("reports circular dependency cluster count in formatted stats output", () => {
    setupSession("s1");
    insertCycleGraph();

    const stats = computeSessionStats(db, "s1", "/test");
    const text = formatStats(stats, "s1");

    expect(stats.circularDependencyClusters).toBe(1);
    expect(text).toContain("1 circular dependency clusters detected");
  });

  it("reports code quality metrics including quality score, dead code count, and large functions", () => {
    setupSession("s1");
    insertQualityFixtures();

    const stats = computeSessionStats(db, "s1", "/test");
    const text = formatStats(stats, "s1");

    expect(stats.deadCodeCount).toBe(1);
    expect(stats.largeFunctions).toEqual([
      expect.objectContaining({
        symbolName: "giantHandler",
        filePath: "src/quality.ts",
        lineCount: 121,
      }),
    ]);
    expect(stats.qualityScore).toBeLessThan(100);
    expect(text).toContain("Quality score:");
    expect(text).toContain("Dead code count: 1");
    expect(text).toContain("Large functions:");
    expect(text).toContain("\"symbolName\":\"giantHandler\"");
  });
});
