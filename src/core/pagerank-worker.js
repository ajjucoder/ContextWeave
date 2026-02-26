import Database from "better-sqlite3";
import { workerData } from "node:worker_threads";
import { computePageRank } from "./graph.ts";
import { symbolQueries } from "../db/queries/symbols.ts";

const { dbPath } = workerData;

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const ranks = computePageRank(db);
const symbolsQ = symbolQueries(db);

const updateAll = db.transaction(() => {
  for (const [symbolId, rank] of ranks) {
    symbolsQ.updateCentrality(symbolId, rank);
  }
});

updateAll();
db.close();
