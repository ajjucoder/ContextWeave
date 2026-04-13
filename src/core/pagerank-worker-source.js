import Database from "better-sqlite3";
import { workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";

const { updateCentralityScores } = await tsImport("./graph.ts", import.meta.url);
const { dbPath } = workerData;

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

updateCentralityScores(db);
db.close();
