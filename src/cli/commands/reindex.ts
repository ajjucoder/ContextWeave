import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations.js";
import { indexDirectory, indexProject, indexSingleFile } from "../../core/indexer.js";
import { runPageRankInBackground } from "../../core/graph.js";
import { createEmbeddingRuntime, disposeEmbeddingRuntime } from "../../core/embedding-runtime.js";
import { loadConfig } from "../../utils/config.js";
import { syncBootstrapObservations } from "../../memory/bootstrap.js";

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

  const config = loadConfig(projectRoot);
  const embeddingRuntime = await createEmbeddingRuntime(db, {
    modelName: config.embeddingModel,
  });

  if (targetPath) {
    const fullPath = resolve(projectRoot, targetPath);
    const isDirectory = existsSync(fullPath) && statSync(fullPath).isDirectory();
    process.stdout.write(`Reindexing ${fullPath}${isDirectory ? " (directory)" : ""}...\n`);
    if (isDirectory) {
      const result = await indexDirectory(db, fullPath, projectRoot, config.ignore, {
        embeddings: embeddingRuntime,
      });
      syncBootstrapObservations(db, projectRoot);
      runPageRankInBackground(dbPath);
      const elapsed = Date.now() - startTime;
      process.stdout.write(`  ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)\n`);
      if (result.errors.length > 0) {
        process.stdout.write(`  ${result.errors.length} files had parse errors\n`);
      }
    } else {
      const result = await indexSingleFile(db, fullPath, projectRoot, undefined, {
        embeddings: embeddingRuntime,
      });
      syncBootstrapObservations(db, projectRoot);
      runPageRankInBackground(dbPath);
      const elapsed = Date.now() - startTime;
      process.stdout.write(`  ${result.symbolCount} symbols (${elapsed}ms)\n`);
    }
  } else {
    process.stdout.write("Reindexing entire project...\n");
    const result = await indexProject(db, projectRoot, config.ignore, {
      embeddings: embeddingRuntime,
    });
    syncBootstrapObservations(db, projectRoot);
    runPageRankInBackground(dbPath);
    const elapsed = Date.now() - startTime;
    process.stdout.write(`  ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)\n`);
    if (result.errors.length > 0) {
      process.stdout.write(`  ${result.errors.length} files had parse errors\n`);
    }
  }

  await disposeEmbeddingRuntime(embeddingRuntime);
  closeDb();
}
