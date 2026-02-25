import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations.js";
import { indexProject } from "../../core/indexer.js";
import { updateCentralityScores } from "../../core/graph.js";
const DEFAULT_CONFIG = {
  version: 1,
  ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
  tokenBudget: 4000,
  defaultMode: "feature",
  stalenessDepth: 2,
  confidenceDecay: 0.1,
  gcThreshold: 0.1,
};

export async function runInit(projectRoot: string): Promise<void> {
  const cwDir = resolve(projectRoot, ".contextweave");

  if (existsSync(cwDir)) {
    process.stdout.write("ContextWeave already initialized in this project.\n");
    process.stdout.write(`Config: ${cwDir}/config.json\n`);
    process.stdout.write(`Database: ${cwDir}/contextweave.db\n`);
    return;
  }

  process.stdout.write("Initializing ContextWeave...\n");

  mkdirSync(cwDir, { recursive: true });

  const configPath = resolve(cwDir, "config.json");
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  process.stdout.write(`  Created ${configPath}\n`);

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  runMigrations(db);
  process.stdout.write(`  Created database at ${dbPath}\n`);

  process.stdout.write("  Indexing project...\n");
  const startTime = Date.now();
  const result = await indexProject(db, projectRoot);
  const elapsed = Date.now() - startTime;

  updateCentralityScores(db);

  process.stdout.write(`  Indexed ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)\n`);

  if (result.errors.length > 0) {
    process.stdout.write(`  ${result.errors.length} files had parse errors\n`);
  }

  process.stdout.write("\nContextWeave initialized successfully!\n");
  process.stdout.write("\nTo use with Claude Code, add to .mcp.json:\n");
  process.stdout.write(JSON.stringify({
    mcpServers: {
      contextweave: {
        command: "node",
        args: [resolve(projectRoot, "node_modules/.bin/cw"), "serve"],
      },
    },
  }, null, 2) + "\n");
}
