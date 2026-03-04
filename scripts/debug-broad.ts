import { createSchema } from '../src/db/schema.js';
import { runMigrations } from '../src/db/migrations.js';
import { indexProject } from '../src/core/indexer.js';
import { updateCentralityScores } from '../src/core/graph.js';
import { generateCapsule } from '../src/capsule/generator.js';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
createSchema(db);
runMigrations(db);
await indexProject(db, resolve(__dirname, '../src'));
updateCentralityScores(db);

const BROAD = [
  'capsule generation pipeline scoring compression',
  'database schema migration tables indexes',
  'file indexing parsing symbol extraction',
  'memory observation staleness confidence decay',
  'MCP server tool registration transport',
];
for (const q of BROAD) {
  const r = generateCapsule(db, { query: q, tokenBudget: 10000 });
  const { coverageConfidence, pivotCount, pivotsIncluded, noiseRatio } = r.metadata.quality;
  const sym = r.metadata.symbolCount;
  console.log(`${coverageConfidence.toFixed(4)} pivots:${pivotsIncluded}/${pivotCount} sym:${sym} "${q}"`);
}
db.close();
