import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

afterAll(() => {
  db.close();
});

describe("Wave 2 acceptance: session intelligence", () => {
  it("multi-query session maintains confidence above 60%", () => {
    const sessionId = "wave2-acceptance-1";
    const queries = ["generateCapsule", "packNodes", "weightedBfsTraversal"];

    for (const query of queries) {
      const result = generateCapsule(db, { query, tokenBudget: 4000, sessionId });
      expect(result.metadata.quality.coverageConfidence).toBeGreaterThan(0.6);
    }
  });

  it("second query in session uses same or fewer tokens than first (dedup effect)", () => {
    const sessionId = "wave2-acceptance-2";
    const query = "generateCapsule";

    const first = generateCapsule(db, { query, tokenBudget: 4000, sessionId });
    const second = generateCapsule(db, { query, tokenBudget: 4000, sessionId });

    expect(second.metadata.tokensUsed).toBeLessThanOrEqual(first.metadata.tokensUsed);
  });

  it("session records symbols — second related query sees prior context", () => {
    const sessionId = "wave2-acceptance-3";

    const first = generateCapsule(db, {
      query: "generateCapsule",
      tokenBudget: 4000,
      sessionId,
    });
    expect(first.metadata.symbolCount).toBeGreaterThan(0);

    const second = generateCapsule(db, {
      query: "formatCapsule packNodes",
      tokenBudget: 4000,
      sessionId,
    });
    expect(second.metadata.symbolCount).toBeGreaterThan(0);
    expect(second.metadata.quality.coverageConfidence).toBeGreaterThan(0.6);
  });
});
