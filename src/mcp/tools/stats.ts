import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { getRegisterTool } from "./register-helper.js";

export const FOLLOW_UP_METRICS_SAMPLE_LIMIT = 200;

export interface SessionStats {
  capsulesGenerated: number;
  totalTokensBudgeted: number;
  totalTokensUsed: number;
  uniqueFiles: number;
  uniqueSymbols: number;
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
  _projectRoot?: string
): SessionStats {
  const logs = capsuleLogQueries(db).getBySession(sessionId);

  if (logs.length === 0) {
    return {
      capsulesGenerated: 0,
      totalTokensBudgeted: 0,
      totalTokensUsed: 0,
      uniqueFiles: 0,
      uniqueSymbols: 0,
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
    firstPassRate: followUpMetrics.firstPassRate,
    correctionRate: followUpMetrics.correctionRate,
    budgetUtilization,
    averageFollowUpReads,
  };
}

function formatStats(stats: SessionStats, sessionId: string): string {
  const avgTokensPerCapsule =
    stats.capsulesGenerated > 0
      ? Math.round(stats.totalTokensUsed / stats.capsulesGenerated)
      : 0;

  const budgetUtilizationPct = (stats.budgetUtilization * 100).toFixed(0);

  const lines = [
    "ContextWeave Session Stats",
    `Session: ${sessionId}`,
    "",
    `Indexed: ${stats.uniqueFiles} files, ${stats.uniqueSymbols} symbols`,
    `Avg tokens per capsule: ${avgTokensPerCapsule.toLocaleString()}`,
    `Budget utilization: ${budgetUtilizationPct}%`,
    "",
    `Capsules issued:       ${stats.capsulesGenerated}`,
    `Total tokens used:     ${stats.totalTokensUsed.toLocaleString()}`,
    `Total tokens budgeted: ${stats.totalTokensBudgeted.toLocaleString()}`,
    `First-pass rate:       ${formatRatePct(stats.firstPassRate)}`,
    `Correction rate:       ${formatRatePct(stats.correctionRate)}`,
    `Avg follow-up reads:   ${stats.averageFollowUpReads.toFixed(2)}`,
  ];

  const qualityNote = stats.budgetUtilization >= 0.5
    ? "Budget utilization healthy"
    : stats.budgetUtilization >= 0.3
      ? "Budget underutilized — capsules may be incomplete"
      : "Budget severely underutilized — consider broader queries or higher budgets";
  lines.push(`Quality: ${qualityNote}`);

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
    "Show session stats: capsules generated, tokens used, budget utilization, files and symbols covered.",
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
