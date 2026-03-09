import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { readFileSync } from "node:fs";
import { getRegisterTool } from "./register-helper.js";
import { resolve } from "node:path";
import { countTokens } from "../../utils/tokens.js";

const AVG_FILE_TOKENS_FALLBACK = 3000;
export const FOLLOW_UP_METRICS_SAMPLE_LIMIT = 200;

export interface SessionStats {
  capsulesGenerated: number;
  totalTokensBudgeted: number;
  totalTokensUsed: number;
  uniqueFiles: number;
  uniqueSymbols: number;
  estimatedRawTokens: number;
  estimatedSavingsPercent: number;
  firstPassRate: number;
  correctionRate: number;
  budgetUtilization: number;
  averageFollowUpReads: number;
}

export interface FollowUpMetrics {
  sampleSize: number;
  firstPassRate: number;
  correctionRate: number;
}

export function computeFollowUpMetrics(
  logs: ReadonlyArray<{
    followedUp: boolean;
  }>
): FollowUpMetrics {
  if (logs.length === 0) {
    return {
      sampleSize: 0,
      firstPassRate: 0,
      correctionRate: 0,
    };
  }

  const correctionCount = logs.reduce((sum, log) => sum + (log.followedUp ? 1 : 0), 0);
  const correctionRate = correctionCount / logs.length;

  return {
    sampleSize: logs.length,
    firstPassRate: 1 - correctionRate,
    correctionRate,
  };
}

export function formatRatePct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function computeSessionStats(
  db: Database.Database,
  sessionId: string,
  projectRoot: string
): SessionStats {
  const logs = capsuleLogQueries(db).getBySession(sessionId);

  if (logs.length === 0) {
    return {
      capsulesGenerated: 0,
      totalTokensBudgeted: 0,
      totalTokensUsed: 0,
      uniqueFiles: 0,
      uniqueSymbols: 0,
      estimatedRawTokens: 0,
      estimatedSavingsPercent: 0,
      firstPassRate: 0,
      correctionRate: 0,
      budgetUtilization: 0,
      averageFollowUpReads: 0,
    };
  }

  let totalBudgeted = 0;
  let totalUsed = 0;
  const allFiles = new Set<string>();
  const allSymbols = new Set<string>();

  for (const log of logs) {
    totalBudgeted += log.tokenBudget;
    totalUsed += log.tokensUsed;
    for (const f of log.filesIncluded) allFiles.add(f);
    for (const s of log.symbolsIncluded) allSymbols.add(s);
  }
  const followUpMetrics = computeFollowUpMetrics(logs);

  let totalFileTokens = 0;
  for (const filePath of allFiles) {
    try {
      const fullPath = resolve(projectRoot, filePath);
      const content = readFileSync(fullPath, "utf-8");
      totalFileTokens += countTokens(content);
    } catch {
      totalFileTokens += AVG_FILE_TOKENS_FALLBACK;
    }
  }

  const estimatedRawTokens = Math.max(totalFileTokens, totalUsed);

  const savings =
    estimatedRawTokens > 0
      ? Math.round(((estimatedRawTokens - totalUsed) / estimatedRawTokens) * 100)
      : 0;

  let budgetUtilizationSum = 0;
  for (const log of logs) {
    budgetUtilizationSum += log.tokenBudget > 0 ? log.tokensUsed / log.tokenBudget : 0;
  }
  const budgetUtilization = budgetUtilizationSum / logs.length;

  const followUpCount = logs.reduce((sum, log) => sum + (log.followedUp ? 1 : 0), 0);
  const averageFollowUpReads = followUpCount / logs.length;

  return {
    capsulesGenerated: logs.length,
    totalTokensBudgeted: totalBudgeted,
    totalTokensUsed: totalUsed,
    uniqueFiles: allFiles.size,
    uniqueSymbols: allSymbols.size,
    estimatedRawTokens,
    estimatedSavingsPercent: Math.max(0, savings),
    firstPassRate: followUpMetrics.firstPassRate,
    correctionRate: followUpMetrics.correctionRate,
    budgetUtilization,
    averageFollowUpReads,
  };
}

function formatStats(stats: SessionStats, sessionId: string): string {
  const lines = [
    "ContextWeave Session Stats",
    `Session: ${sessionId}`,
    "",
    `Capsules generated:    ${stats.capsulesGenerated}`,
    `Total tokens budgeted: ${stats.totalTokensBudgeted.toLocaleString()}`,
    `Total tokens used:     ${stats.totalTokensUsed.toLocaleString()} (${stats.totalTokensBudgeted > 0 ? Math.round((stats.totalTokensUsed / stats.totalTokensBudgeted) * 100) : 0}% of budget)`,
    `Unique files covered:  ${stats.uniqueFiles}`,
    `Unique symbols served: ${stats.uniqueSymbols}`,
    `First-pass rate:       ${formatRatePct(stats.firstPassRate)}`,
    `Correction rate:       ${formatRatePct(stats.correctionRate)}`,
    `Budget utilization:    ${formatRatePct(stats.budgetUtilization)}`,
    `Avg follow-up reads:   ${stats.averageFollowUpReads.toFixed(2)}`,
  ];

  if (stats.capsulesGenerated > 0) {
    lines.push(
      "",
      "Savings vs equivalent grep+read:",
      `  grep+read cost (est): ~${stats.estimatedRawTokens.toLocaleString()} tokens`,
      `  ContextWeave used:    ~${stats.totalTokensUsed.toLocaleString()} tokens`,
      `  Estimated savings:    ~${(stats.estimatedRawTokens - stats.totalTokensUsed).toLocaleString()} tokens (${stats.estimatedSavingsPercent}% reduction)`
    );
  }

  return lines.join("\n");
}

export function registerStatsTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  serverSessionId: string
): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_stats",
    "Show session context savings: capsules generated, tokens used vs estimated raw reads, files and symbols covered.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Session ID to query (default: current session)"),
    },
    async ({ session_id }: { session_id?: string }) => {
      try {
        const targetSession = session_id ?? serverSessionId;
        const stats = computeSessionStats(db, targetSession, projectRoot);
        const text = formatStats(stats, targetSession);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Stats failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
