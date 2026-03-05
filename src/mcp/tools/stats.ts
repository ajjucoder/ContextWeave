import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { statSync } from "node:fs";
import { getRegisterTool } from "./register-helper.js";
import { resolve } from "node:path";

const AVG_FILE_TOKENS_FALLBACK = 3000;
const BYTES_PER_TOKEN_ESTIMATE = 4;

export interface SessionStats {
  capsulesGenerated: number;
  totalTokensBudgeted: number;
  totalTokensUsed: number;
  uniqueFiles: number;
  uniqueSymbols: number;
  estimatedRawTokens: number;
  estimatedSavingsPercent: number;
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

  let estimatedRawTokens = 0;
  for (const filePath of allFiles) {
    try {
      const fullPath = resolve(projectRoot, filePath);
      const size = statSync(fullPath).size;
      estimatedRawTokens += Math.ceil(size / BYTES_PER_TOKEN_ESTIMATE);
    } catch {
      estimatedRawTokens += AVG_FILE_TOKENS_FALLBACK;
    }
  }

  estimatedRawTokens = Math.max(estimatedRawTokens, totalUsed);

  const savings =
    estimatedRawTokens > 0
      ? Math.round(((estimatedRawTokens - totalUsed) / estimatedRawTokens) * 100)
      : 0;

  return {
    capsulesGenerated: logs.length,
    totalTokensBudgeted: totalBudgeted,
    totalTokensUsed: totalUsed,
    uniqueFiles: allFiles.size,
    uniqueSymbols: allSymbols.size,
    estimatedRawTokens,
    estimatedSavingsPercent: Math.max(0, savings),
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
  ];

  if (stats.capsulesGenerated > 0) {
    lines.push(
      "",
      "Estimated savings:",
      `  Raw file reads (est): ~${stats.estimatedRawTokens.toLocaleString()} tokens`,
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
