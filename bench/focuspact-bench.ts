import { getDb } from "../src/db/connection.js";
import { generateCapsule } from "../src/capsule/generator.js";

const PROJECT_ROOT =
  "/path/to/project";
const DB_PATH = `${PROJECT_ROOT}/.contextweave/contextweave.db`;

const QUERIES = [
  "user authentication login",
  "task creation form submit",
  "database connection prisma",
  "API route handler middleware",
  "focus session timer countdown",
  "notification system",
  "settings page user preferences",
  "error handling validation",
];

const TOKEN_BUDGET = 4000;

function countCharsAsTokens(text: string): number {
  return Math.round(text.length / 3.5);
}

async function main() {
  const db = getDb(DB_PATH);

  const results: Array<{
    query: string;
    tokens: number;
    pivotCount: number;
    pivotsIncluded: number;
    pivotCoverage: number;
    noiseRatio: number;
    uncertainty: string;
    content: string;
  }> = [];

  for (const query of QUERIES) {
    const output = generateCapsule(db, {
      query,
      tokenBudget: TOKEN_BUDGET,
      mode: "feature",
      sessionId: "bench",
      projectRoot: PROJECT_ROOT,
    });

    results.push({
      query,
      tokens: output.metadata.tokensUsed,
      pivotCount: output.metadata.quality.pivotCount,
      pivotsIncluded: output.metadata.quality.pivotsIncluded,
      pivotCoverage: output.metadata.quality.pivotCoverage,
      noiseRatio: output.metadata.quality.noiseRatio,
      uncertainty: output.metadata.quality.uncertainty,
      content: output.content,
    });
  }

  // Print results table
  process.stdout.write("\n=== CONTEXTWEAVE BENCHMARK: focusPact ===\n\n");
  process.stdout.write(
    `Index: 102 files | 551 symbols | 1537 edges | 2292ms init\n\n`
  );

  process.stdout.write(
    "Query".padEnd(40) +
      "Tokens".padEnd(8) +
      "Reduction%".padEnd(12) +
      "Pivots".padEnd(10) +
      "Coverage".padEnd(10) +
      "Noise".padEnd(8) +
      "Uncertainty\n"
  );
  process.stdout.write("-".repeat(100) + "\n");

  const NAIVE_TOKENS_PER_FILE = 800; // ~2800 chars / 3.5
  const NAIVE_TOTAL = 102 * NAIVE_TOKENS_PER_FILE;

  let totalReduction = 0;

  for (const r of results) {
    const reduction = ((1 - r.tokens / NAIVE_TOTAL) * 100).toFixed(1);
    totalReduction += parseFloat(reduction);
    const pivots = `${r.pivotsIncluded}/${r.pivotCount}`;
    process.stdout.write(
      r.query.padEnd(40) +
        r.tokens.toString().padEnd(8) +
        `${reduction}%`.padEnd(12) +
        pivots.padEnd(10) +
        r.pivotCoverage.toFixed(2).padEnd(10) +
        r.noiseRatio.toFixed(2).padEnd(8) +
        r.uncertainty +
        "\n"
    );
  }

  process.stdout.write("-".repeat(100) + "\n");
  process.stdout.write(
    `Average token reduction vs naive full-codebase: ${(totalReduction / QUERIES.length).toFixed(1)}%\n`
  );
  process.stdout.write(`Naive baseline (all files): ~${NAIVE_TOTAL} tokens\n\n`);

  // Print the 3 most interesting capsule outputs
  const best = results.reduce((a, b) => (a.pivotCoverage > b.pivotCoverage ? a : b));
  const worst = results.reduce((a, b) => (a.pivotCoverage < b.pivotCoverage ? a : b));
  const edgeCase = results.find((r) => r.uncertainty !== "low" && r !== worst) ?? results[2]!;

  process.stdout.write("\n" + "=".repeat(80) + "\n");
  process.stdout.write(`CAPSULE 1 (BEST): "${best.query}"\n`);
  process.stdout.write("=".repeat(80) + "\n");
  process.stdout.write(best.content + "\n");

  process.stdout.write("\n" + "=".repeat(80) + "\n");
  process.stdout.write(`CAPSULE 2 (WORST): "${worst.query}"\n`);
  process.stdout.write("=".repeat(80) + "\n");
  process.stdout.write(worst.content + "\n");

  process.stdout.write("\n" + "=".repeat(80) + "\n");
  process.stdout.write(`CAPSULE 3 (EDGE CASE): "${edgeCase.query}"\n`);
  process.stdout.write("=".repeat(80) + "\n");
  process.stdout.write(edgeCase.content + "\n");

  db.close();
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.stderr.write(err.stack + "\n");
  process.exit(1);
});
