import Database from "better-sqlite3";
import { workerData } from "node:worker_threads";
import { updateCentralityScores } from "./graph.ts";

const { dbPath } = workerData;

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

updateCentralityScores(db);
db.close();
