import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations.js";
import { indexProject, indexSingleFile } from "../../core/indexer.js";
import { updateCentralityScores } from "../../core/graph.js";

export async function runReindex(projectRoot: string, targetPath?: string): Promise<void> {
  const cwDir = resolve(projectRoot, ".contextweave");

  if (!existsSync(cwDir)) {
    process.stdout.write("ContextWeave not initialized. Run `cw init` first.\n");
    process.exit(1);
  }

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  runMigrations(db);

  const startTime = Date.now();

  if (targetPath) {
    const fullPath = resolve(projectRoot, targetPath);
    process.stdout.write(`Reindexing ${fullPath}...\n`);
    const result = indexSingleFile(db, fullPath, projectRoot);
    updateCentralityScores(db);
    const elapsed = Date.now() - startTime;
    process.stdout.write(`  ${result.symbolCount} symbols (${elapsed}ms)\n`);
  } else {
    process.stdout.write("Reindexing entire project...\n");
    const result = await indexProject(db, projectRoot);
    updateCentralityScores(db);
    const elapsed = Date.now() - startTime;
    process.stdout.write(`  ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)\n`);
    if (result.errors.length > 0) {
      process.stdout.write(`  ${result.errors.length} files had parse errors\n`);
    }
  }

  closeDb();
}
