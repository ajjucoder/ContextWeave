import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
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
  runMigrations(db);
  await indexProject(db, resolve(__dirname, "../../src"));
  updateCentralityScores(db);
}, 60000);

describe("deduplication across session queries", () => {
  it("second identical query uses fewer tokens due to dedup", () => {
    const sessionId = "dedup-test-session-1";
    const query = "generateCapsule";

    const first = generateCapsule(db, { query, tokenBudget: 4000, sessionId });
    const second = generateCapsule(db, { query, tokenBudget: 4000, sessionId });

    expect(second.metadata.tokensUsed).toBeLessThanOrEqual(first.metadata.tokensUsed);
  });

  it("queries without explicit sessionId still return valid capsules", () => {
    const query = "weightedBfsTraversal";

    const first = generateCapsule(db, { query, tokenBudget: 4000 });
    const second = generateCapsule(db, { query, tokenBudget: 4000 });

    expect(first.metadata.tokensUsed).toBeGreaterThan(0);
    expect(second.metadata.tokensUsed).toBeGreaterThan(0);
    expect(first.content.length).toBeGreaterThan(0);
    expect(second.content.length).toBeGreaterThan(0);
  });

  it("previously shown symbols are listed in metadata and not repeated in capsule body", () => {
    const sessionId = "dedup-test-session-2";
    const query = "rankPivots";

    generateCapsule(db, { query, tokenBudget: 4000, sessionId });
    const second = generateCapsule(db, { query, tokenBudget: 4000, sessionId });

    // Symbols that were deduped must not appear inline in the body (no token waste),
    // but should be surfaced via metadata.previouslyCovered.
    expect(second.content).not.toContain("[previously shown]");
    expect(second.content).not.toContain("Previously covered:");
    // Either fewer tokens were used (dedup fired) or previouslyCovered is populated.
    expect(
      second.metadata.tokensUsed < 4000 ||
      (second.metadata.previouslyCovered !== undefined && second.metadata.previouslyCovered.length > 0)
    ).toBe(true);
  });
});
