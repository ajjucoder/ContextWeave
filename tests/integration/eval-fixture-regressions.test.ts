import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { capsuleLogQueries } from "../../src/db/queries/capsule-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../bench/scenarios/small-project/src"));
  updateCentralityScores(db);
}, 60000);

afterAll(() => db?.close());

describe("eval fixture regressions", () => {
  it("keeps create auth stack focused on runtime wiring instead of exported auth types", () => {
    generateCapsule(db, {
      query: "create auth stack",
      tokenBudget: 4000,
      sessionId: "eval-fixture-regression",
      projectRoot: resolve(__dirname, "../../bench/scenarios/small-project/src"),
    });

    const latest = capsuleLogQueries(db).getLatest();
    expect(latest).toBeTruthy();

    const topFiles = latest!.filesIncluded.slice(0, 5).map((file) => file.split("/").pop());
    const topSymbols = latest!.symbolsIncluded.slice(0, 6);
    const topTwoSymbols = latest!.symbolsIncluded.slice(0, 2);

    expect(topFiles).toContain("index.ts");
    expect(topFiles).toContain("handler.ts");
    expect(topSymbols).toContain("createAuthStack");
    expect(topSymbols).toContain("AuthHandler");
    expect(topTwoSymbols).not.toContain("AuthToken");
  });

  it("handles session entry lifecycle as a first-pass auth-path query", () => {
    const capsule = generateCapsule(db, {
      query: "session entry lifecycle",
      tokenBudget: 4000,
      sessionId: "eval-fixture-session-entry",
      projectRoot: resolve(__dirname, "../../bench/scenarios/small-project/src"),
    });

    expect(capsule.content).toContain("handler.ts");
    expect(capsule.content).toContain("service.ts");
    expect(capsule.content).toContain("handleLogin");
    expect(capsule.content).toContain("AuthService");
    expect(capsule.metadata.quality.coverageConfidence).toBeGreaterThan(0.39);
    expect(capsule.metadata.quality.reasons).not.toContain("query term coverage below 60%");
  });
});
