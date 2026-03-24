import { beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../../src/db/schema.js";
import { runMigrations } from "../../../src/db/migrations.js";
import { indexProject } from "../../../src/core/indexer.js";
import { updateCentralityScores } from "../../../src/core/graph.js";
import { createCapsuleContext, type CapsuleContext } from "../../../src/capsule/pipeline/types.js";

const SRC_DIR = resolve(__dirname, "../../../src");

export interface PipelineFixture {
  db: Database.Database;
  projectRoot: string;
  createContext(query: string, overrides?: Partial<CapsuleContext["params"]>): CapsuleContext;
}

export function usePipelineFixture(): PipelineFixture {
  let db: Database.Database;

  beforeAll(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);
    await indexProject(db, SRC_DIR);
    updateCentralityScores(db);
  }, 60000);

  afterAll(() => {
    db.close();
  });

  return {
    get db() {
      return db;
    },
    projectRoot: SRC_DIR,
    createContext(query, overrides = {}) {
      return createCapsuleContext(db, {
        query,
        tokenBudget: 4500,
        projectRoot: SRC_DIR,
        ...overrides,
      });
    },
  };
}
