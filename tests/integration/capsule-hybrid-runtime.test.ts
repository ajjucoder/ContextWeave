import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { chunkQueries } from "../../src/db/queries/chunks.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { generateCapsuleWithRuntime } from "../../src/capsule/generator.js";
import type { ChunkEmbeddingEntry, EmbeddingRuntime } from "../../src/core/types.js";

let db: Database.Database;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cw-capsule-hybrid-"));
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);

  mkdirSync(join(root, "src", "ui"), { recursive: true });
  mkdirSync(join(root, "src", "core"), { recursive: true });

  writeFileSync(
    join(root, "src", "ui", "LeadCapturePanel.tsx"),
    `export function LeadCapturePanel() {
  return <div>lead capture lifecycle</div>;
}
`
  );
  writeFileSync(
    join(root, "src", "core", "createInquiry.ts"),
    `export function createInquiry() {
  return persistInquiry();
}

export function persistInquiry() {
  return "ok";
}
`
  );

  await indexProject(db, root);
  updateCentralityScores(db);
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("generateCapsuleWithRuntime", () => {
  it("uses hybrid chunk results to rescue semantic runtime queries", async () => {
    const baseline = generateCapsule(db, {
      query: "lead capture lifecycle",
      tokenBudget: 300,
      projectRoot: root,
      sessionId: "baseline",
    });

    const coreFile = fileQueries(db).getAll().find((file) => file.path.endsWith("src/core/createInquiry.ts"));
    if (!coreFile) {
      throw new Error("Expected indexed core file");
    }

    const [coreChunk] = chunkQueries(db).getByFileId(coreFile.id);
    if (!coreChunk) {
      throw new Error("Expected indexed chunk for core file");
    }

    const runtime: EmbeddingRuntime = {
      embedder: {
        async embed(): Promise<Float32Array> {
          return new Float32Array(384);
        },
        async embedBatch(): Promise<Float32Array[]> {
          return [];
        },
      },
      vectorStore: {
        storeBatch(_entries: ChunkEmbeddingEntry[]): void {},
        search() {
          return [
            {
              chunkId: coreChunk.id,
              fileId: coreFile.id,
              filePath: coreFile.path,
              startLine: coreChunk.startLine,
              endLine: coreChunk.endLine,
              distance: 0.01,
              scopeChain: coreChunk.scopeChain,
              entityNames: coreChunk.entityNames,
              tokenCount: coreChunk.tokenCount,
            },
          ];
        },
        searchWithFilter() {
          throw new Error("generateCapsuleWithRuntime should use vectorStore.search()");
        },
      },
      modelName: "test-hybrid-model",
    };

    const result = await generateCapsuleWithRuntime(db, {
      query: "lead capture lifecycle",
      tokenBudget: 300,
      projectRoot: root,
      sessionId: "hybrid",
    }, runtime);

    expect(baseline.metadata.strategy?.hybridSearch?.enabled).toBe(false);
    expect(result.content).toContain("core/createInquiry.ts");
    expect(result.metadata.strategy?.hybridSearch?.enabled).toBe(true);
    expect(result.metadata.strategy?.hybridSearch?.applied).toBe(true);
  });
});
