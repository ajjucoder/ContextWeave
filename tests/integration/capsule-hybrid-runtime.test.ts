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
  writeFileSync(
    join(root, "src", "core", "ChargeDeclinedException.ts"),
    `export class ChargeDeclinedException extends Error {
  constructor() {
    super("card declined");
  }
}
`
  );
  writeFileSync(
    join(root, "src", "ui", "handlePaymentFailure.ts"),
    `export function handlePaymentFailure() {
  return "payment failure";
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

  it("uses hybrid cosine scoring to surface semantic matches while preserving exact narrow ranking", async () => {
    const files = fileQueries(db).getAll();
    const chunks = chunkQueries(db);
    const declinedFile = files.find((file) => file.path.endsWith("src/core/ChargeDeclinedException.ts"));
    const failureFile = files.find((file) => file.path.endsWith("src/ui/handlePaymentFailure.ts"));
    if (!declinedFile || !failureFile) {
      throw new Error("Expected payment failure fixture files");
    }

    const [declinedChunk] = chunks.getByFileId(declinedFile.id);
    const [failureChunk] = chunks.getByFileId(failureFile.id);
    if (!declinedChunk || !failureChunk) {
      throw new Error("Expected payment failure fixture chunks");
    }

    db.prepare(`
      INSERT INTO chunk_embeddings (id, file_id, start_line, end_line, text_hash, embedding, model_name)
      VALUES
        (?, ?, ?, ?, ?, ?, 'test-hybrid-model'),
        (?, ?, ?, ?, ?, ?, 'test-hybrid-model')
    `).run(
      declinedChunk.id,
      declinedFile.id,
      declinedChunk.startLine,
      declinedChunk.endLine,
      declinedChunk.contentHash,
      Buffer.from(new Float32Array([0.95, 0.05]).buffer),
      failureChunk.id,
      failureFile.id,
      failureChunk.startLine,
      failureChunk.endLine,
      failureChunk.contentHash,
      Buffer.from(new Float32Array([0.20, 0.80]).buffer)
    );

    const runtime: EmbeddingRuntime = {
      embedder: {
        async embed(): Promise<Float32Array> {
          return new Float32Array([1, 0]);
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
              chunkId: declinedChunk.id,
              fileId: declinedFile.id,
              filePath: declinedFile.path,
              startLine: declinedChunk.startLine,
              endLine: declinedChunk.endLine,
              distance: 0.01,
              scopeChain: declinedChunk.scopeChain,
              entityNames: declinedChunk.entityNames,
              tokenCount: declinedChunk.tokenCount,
            },
            {
              chunkId: failureChunk.id,
              fileId: failureFile.id,
              filePath: failureFile.path,
              startLine: failureChunk.startLine,
              endLine: failureChunk.endLine,
              distance: 0.2,
              scopeChain: failureChunk.scopeChain,
              entityNames: failureChunk.entityNames,
              tokenCount: failureChunk.tokenCount,
            },
          ];
        },
        searchWithFilter() {
          throw new Error("generateCapsuleWithRuntime should use vectorStore.search()");
        },
      },
      modelName: "test-hybrid-model",
    };

    const semantic = await generateCapsuleWithRuntime(db, {
      query: "where do we handle payment failure scenarios",
      tokenBudget: 350,
      projectRoot: root,
      sessionId: "hybrid-semantic",
    }, runtime);

    expect(semantic.content).toContain("ChargeDeclinedException");

    const exact = await generateCapsuleWithRuntime(db, {
      query: "ChargeDeclinedException",
      tokenBudget: 350,
      projectRoot: root,
      sessionId: "hybrid-exact",
    }, runtime);

    const exactIndex = exact.content.indexOf("ChargeDeclinedException");
    const semanticNeighborIndex = exact.content.indexOf("handlePaymentFailure");
    expect(exactIndex).toBeGreaterThanOrEqual(0);
    if (semanticNeighborIndex >= 0) {
      expect(exactIndex).toBeLessThan(semanticNeighborIndex);
    }
  });
});
