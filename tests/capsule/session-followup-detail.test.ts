import { beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;
const projectRoot = resolve("tests/field/fixtures/sitecraft");

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, projectRoot);
  updateCentralityScores(db);
}, 60000);

describe("session follow-up detail retention", () => {
  it("keeps full narrow symbol detail after a broader same-session query", () => {
    const baseline = generateCapsule(db, {
      query: "createInquiry",
      tokenBudget: 1200,
      projectRoot,
    });

    expect(baseline.content).toContain("async function createInquiry()");
    expect(baseline.content).not.toContain("[previously shown]");

    const sessionId = "followup-detail-session";
    generateCapsule(db, {
      query: "inquiry submission email flow",
      tokenBudget: 1200,
      sessionId,
      projectRoot,
    });

    const followup = generateCapsule(db, {
      query: "createInquiry",
      tokenBudget: 1200,
      sessionId,
      projectRoot,
    });

    expect(followup.content).toContain("async function createInquiry()");
    expect(followup.content).not.toContain("[previously shown]");
  });
});
