import Database from "better-sqlite3";
import { createSchema } from "../src/db/schema.js";
import { runMigrations } from "../src/db/migrations.js";
import { indexProject } from "../src/core/indexer.js";
import { updateCentralityScores } from "../src/core/graph.js";
import { generateCapsule } from "../src/capsule/generator.js";

const PROJECT_ROOT = "/path/to/project";
const TOKEN_BUDGET = 10000;
const TARGET_ENTITIES = [
  "PaperExecutionAdapter",
  "LiveWebSocketFeedAdapter",
  "src/paper/runner.ts",
] as const;
const QUERIES = [
  "paper trading runner strategy engine execution adapter profit",
  "backtest results profit PnL win rate equity drawdown",
] as const;

interface QueryReport {
  query: string;
  symbolCount: number;
  fileCount: number;
  tokensUsed: number;
  utilizationPct: number;
  coverageConfidencePct: number;
  uncertainty: string;
  stageACandidates: number;
  stageBSelected: number;
  entitiesFound: string[];
}

function formatReport(report: QueryReport): string[] {
  const lines: string[] = [];
  lines.push(`Query: ${report.query}`);
  lines.push(`  Symbols: ${report.symbolCount}`);
  lines.push(`  Files: ${report.fileCount}`);
  lines.push(`  Tokens: ${report.tokensUsed}/${TOKEN_BUDGET} (${report.utilizationPct.toFixed(1)}%)`);
  lines.push(`  Coverage confidence: ${report.coverageConfidencePct.toFixed(1)}%`);
  lines.push(`  Uncertainty: ${report.uncertainty}`);
  lines.push(`  Retrieval: stageA ${report.stageACandidates} -> stageB ${report.stageBSelected}`);
  lines.push(
    `  Target entities present: ${report.entitiesFound.length}/${TARGET_ENTITIES.length} (${report.entitiesFound.join(", ") || "none"})`
  );
  return lines;
}

async function main(): Promise<void> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  try {
    createSchema(db);
    runMigrations(db);

    const indexResult = await indexProject(db, PROJECT_ROOT);
    updateCentralityScores(db);

    const reports: QueryReport[] = QUERIES.map((query) => {
      const capsule = generateCapsule(db, {
        query,
        tokenBudget: TOKEN_BUDGET,
        mode: "feature",
        projectRoot: PROJECT_ROOT,
      });
      const entitiesFound = TARGET_ENTITIES.filter((entity) =>
        capsule.content.toLowerCase().includes(entity.toLowerCase())
      );
      return {
        query,
        symbolCount: capsule.metadata.symbolCount,
        fileCount: capsule.metadata.fileCount,
        tokensUsed: capsule.metadata.tokensUsed,
        utilizationPct: (capsule.metadata.tokensUsed / TOKEN_BUDGET) * 100,
        coverageConfidencePct: capsule.metadata.quality.coverageConfidence * 100,
        uncertainty: capsule.metadata.quality.uncertainty,
        stageACandidates: capsule.metadata.quality.retrieval.stageACandidateCount,
        stageBSelected: capsule.metadata.quality.retrieval.stageBSelectedCount,
        entitiesFound,
      };
    });

    console.log("Wave 5 Polymarket Validation");
    console.log(`Project: ${PROJECT_ROOT}`);
    console.log(`Indexed files: ${indexResult.filesIndexed}`);
    console.log(`Indexed symbols: ${indexResult.symbolsFound}`);
    console.log("");

    for (const report of reports) {
      for (const line of formatReport(report)) {
        console.log(line);
      }
      console.log("");
    }

    const avgUtilization =
      reports.reduce((sum, report) => sum + report.utilizationPct, 0) / reports.length;
    const avgConfidence =
      reports.reduce((sum, report) => sum + report.coverageConfidencePct, 0) / reports.length;
    const minEntitiesFound = Math.min(...reports.map((report) => report.entitiesFound.length));
    const nonEmpty = reports.every((report) => report.symbolCount > 0 && report.fileCount > 0);

    console.log("Summary:");
    console.log(`  Non-empty outputs: ${nonEmpty ? "yes" : "no"}`);
    console.log(`  Avg budget utilization: ${avgUtilization.toFixed(1)}%`);
    console.log(`  Avg coverage confidence: ${avgConfidence.toFixed(1)}%`);
    console.log(`  Min target entities found/query: ${minEntitiesFound}/${TARGET_ENTITIES.length}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
