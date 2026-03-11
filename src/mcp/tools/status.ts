import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { observationQueries } from "../../db/queries/observations.js";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { getRegisterTool } from "./register-helper.js";
import { buildProjectProfile, formatProjectProfile } from "../../utils/project-profile.js";
import { loadProfile, formatRepoProfile } from "../../core/repo-profiler.js";
import {
  computeFollowUpMetrics,
  FOLLOW_UP_METRICS_SAMPLE_LIMIT,
  formatRatePct,
} from "./stats.js";
import { createLspBridge, formatLspStatus } from "../../core/lsp-bridge.js";

export function registerStatusTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_status",
    "Show index health: file count, symbol count, edge count, stale observations, and last index time.",
    {
      verbose: z.boolean().optional().describe("Show per-file details (default: false)"),
    },
    async ({ verbose }: { verbose?: boolean }) => {
      try {
        const files = fileQueries(db);
        const symbols = symbolQueries(db);
        const edges = edgeQueries(db);
        const observations = observationQueries(db);

        const fileCount = files.count();
        const symbolCount = symbols.count();
        const edgeCount = edges.count();
        const observationCount = observations.count();
        const staleCount = observations.countStale();
        const recentCapsules = capsuleLogQueries(db).getRecent(5);
        const rateSample = capsuleLogQueries(db).getRecent(FOLLOW_UP_METRICS_SAMPLE_LIMIT);
        const followUpMetrics = computeFollowUpMetrics(rateSample);

        const allFiles = files.getAll();
        const lspBridge = createLspBridge(projectRoot);
        const lines = [
          `ContextWeave Index Status`,
          `Project: ${projectRoot}`,
          ``,
          `Files:        ${fileCount}`,
          `Symbols:      ${symbolCount}`,
          `Edges:        ${edgeCount}`,
          `Observations: ${observationCount} (${staleCount} stale)`,
          `First-pass rate: ${formatRatePct(followUpMetrics.firstPassRate)} (${followUpMetrics.sampleSize} capsules)`,
          `Correction rate: ${formatRatePct(followUpMetrics.correctionRate)} (${followUpMetrics.sampleSize} capsules)`,
          ``,
          ...formatLspStatus(lspBridge),
        ];
        const profile = buildProjectProfile(projectRoot, allFiles);
        lines.push("", ...formatProjectProfile(profile));

        const repoProfile = loadProfile(db, projectRoot);
        if (repoProfile && repoProfile.frameworks.length > 0) {
          lines.push("", ...formatRepoProfile(repoProfile));
        }

        const SOURCE_DIR_PREFIXES = ["src/", "lib/", "app/", "packages/"];
        const nonSourceFiles = allFiles.filter(
          (f) => !SOURCE_DIR_PREFIXES.some((prefix) => f.path.startsWith(prefix))
        );
        if (allFiles.length > 0 && nonSourceFiles.length / allFiles.length > 0.5) {
          const pct = Math.round((nonSourceFiles.length / allFiles.length) * 100);
          lines.push(
            ``,
            `Warning: ${pct}% of indexed files are from non-source directories. Consider adding exclusions to .cwignore.`
          );
        }

        if (recentCapsules.length > 0) {
          lines.push(``, `Recent Capsule Generations:`);
          for (const log of recentCapsules) {
            const date = new Date(log.timestamp).toISOString().replace("T", " ").slice(0, 19);
            const pct = Math.round((log.tokensUsed / log.tokenBudget) * 100);
            lines.push(`  [${date}] "${log.query}" — ${log.tokensUsed}/${log.tokenBudget} tokens (${pct}%), ${log.symbolsIncluded.length} symbols, noise: ${(log.noiseRatio ?? 0).toFixed(2)}`);
          }
        }

        if (verbose) {
          lines.push(`\nPer-file breakdown:`);
          for (const file of allFiles) {
            const errTag = file.error ? ` [ERROR: ${file.error}]` : "";
            lines.push(`  ${file.path} (${file.symbolCount} symbols, ${file.language})${errTag}`);
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Status failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
