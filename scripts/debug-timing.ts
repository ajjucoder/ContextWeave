import { createSchema } from '../src/db/schema.js';
import { runMigrations } from '../src/db/migrations.js';
import { indexProject } from '../src/core/indexer.js';
import { updateCentralityScores } from '../src/core/graph.js';
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

// Simulate the timing-sensitive part
const t0 = Date.now();
const ids = (db.prepare('SELECT id FROM symbols LIMIT 200').all() as {id:number}[]).map(r => r.id);
const t1 = Date.now();
const placeholders = ids.map(() => '?').join(',');
const rows = db.prepare(
  `SELECT e.source_symbol_id, s.name AS target_name, e.kind
   FROM edges e
   JOIN symbols s ON s.id = e.target_symbol_id
   WHERE e.source_symbol_id IN (${placeholders})
     AND e.kind IN ('call', 'import')`
).all(...ids);
const t2 = Date.now();
console.log(`fetch ${ids.length} ids: ${t1-t0}ms, batch edge query: ${t2-t1}ms, rows: ${rows.length}`);

// How long does buildScoredNodes take overall with timing context?
// maxQueryTimeMs = 500ms — if batchFetch takes > 250ms, skipBfs fires; > 400ms, skipPromotion fires
const edgeCount = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as {c:number}).c;
console.log(`total edges in db: ${edgeCount}`);
db.close();
