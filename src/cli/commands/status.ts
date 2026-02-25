import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations.js";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { edgeQueries } from "../../db/queries/edges.js";
import { observationQueries } from "../../db/queries/observations.js";

export function runStatus(projectRoot: string, verbose: boolean): void {
  const cwDir = resolve(projectRoot, ".contextweave");

  if (!existsSync(cwDir)) {
    process.stdout.write("ContextWeave not initialized. Run `cw init` first.\n");
    process.exit(1);
  }

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  runMigrations(db);

  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const observations = observationQueries(db);

  const fileCount = files.count();
  const symbolCount = symbols.count();
  const edgeCount = edges.count();
  const obsCount = observations.count();
  const staleCount = observations.countStale();

  process.stdout.write(`ContextWeave Index Status\n`);
  process.stdout.write(`Project: ${projectRoot}\n\n`);
  process.stdout.write(`Files:        ${fileCount}\n`);
  process.stdout.write(`Symbols:      ${symbolCount}\n`);
  process.stdout.write(`Edges:        ${edgeCount}\n`);
  process.stdout.write(`Observations: ${obsCount} (${staleCount} stale)\n`);

  if (verbose) {
    process.stdout.write(`\nPer-file breakdown:\n`);
    const allFiles = files.getAll();
    for (const file of allFiles) {
      const errTag = file.error ? ` [ERROR]` : "";
      process.stdout.write(`  ${file.path} (${file.symbolCount} symbols, ${file.language})${errTag}\n`);
    }
  }

  closeDb();
}
