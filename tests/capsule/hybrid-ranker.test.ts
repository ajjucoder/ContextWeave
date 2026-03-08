import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { chunkQueries } from "../../src/db/queries/chunks.js";
import { hybridSearch } from "../../src/core/hybrid-ranker.js";
import type { ChunkEmbeddingEntry, EmbeddingRuntime, VectorSearchResult } from "../../src/core/types.js";

let db: Database.Database;

function createRuntime(results: VectorSearchResult[]): EmbeddingRuntime {
  return {
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
      search(_queryEmbedding: Float32Array, _limit?: number): VectorSearchResult[] {
        return results;
      },
      searchWithFilter(_queryEmbedding: Float32Array, _pathFilter?: string, _limit?: number): VectorSearchResult[] {
        return results;
      },
    },
    modelName: "test-hybrid-model",
  };
}

function insertChunkFixture(
  filePath: string,
  symbolName: string,
  options: {
    signature?: string;
    startLine?: number;
    endLine?: number;
    mtime?: number;
    chunkText?: string;
  } = {}
): { fileId: number; symbolId: number; chunkId: number } {
  const now = options.mtime ?? Date.now();
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const chunks = chunkQueries(db);

  const fileId = files.insert({
    path: filePath,
    hash: `${symbolName}-hash`,
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });

  const startLine = options.startLine ?? 1;
  const endLine = options.endLine ?? 20;
  const symbolId = symbols.insert({
    fileId,
    name: symbolName,
    kind: "function",
    startLine,
    endLine,
    signature: options.signature ?? `function ${symbolName}()`,
    bodyHash: `${symbolName}-body`,
    fullSource: `export function ${symbolName}() { return "${symbolName}"; }`,
    isExported: true,
    docComment: null,
    centrality: 1,
    lastSeen: now,
  });

  chunks.replaceForFile(fileId, [
    {
      chunkIndex: 0,
      startLine,
      endLine,
      startByte: 0,
      endByte: 100,
      text: options.chunkText ?? `${symbolName} implementation`,
      contextualizedText: options.chunkText ?? `${symbolName} implementation`,
      scopeChain: [symbolName],
      importSources: [],
      siblingNames: [],
      entityNames: [symbolName],
      tokenCount: 24,
      contentHash: `${symbolName}-chunk`,
    },
  ]);

  const [chunk] = chunks.getByFileId(fileId);
  if (!chunk) {
    throw new Error("Expected chunk fixture to be created");
  }

  return { fileId, symbolId, chunkId: chunk.id };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("hybridSearch", () => {
  it("elevates exact symbol matches above vector-only neighbors", async () => {
    const exact = insertChunkFixture("src/services/user-service.ts", "UserService");
    const semantic = insertChunkFixture("src/features/session-runtime.ts", "SessionRuntime");

    const runtime = createRuntime([
      {
        chunkId: semantic.chunkId,
        fileId: semantic.fileId,
        filePath: "src/features/session-runtime.ts",
        startLine: 1,
        endLine: 20,
        distance: 0.03,
        scopeChain: ["SessionRuntime"],
        entityNames: ["SessionRuntime"],
        tokenCount: 24,
      },
      {
        chunkId: exact.chunkId,
        fileId: exact.fileId,
        filePath: "src/services/user-service.ts",
        startLine: 1,
        endLine: 20,
        distance: 0.04,
        scopeChain: ["UserService"],
        entityNames: ["UserService"],
        tokenCount: 24,
      },
    ]);

    const results = await hybridSearch(db, runtime, {
      query: "UserService",
      queryTerms: ["UserService"],
      queryEmbedding: new Float32Array(384),
      projectRoot: "/repo",
      limit: 5,
    });

    expect(results[0]?.filePath).toBe("src/services/user-service.ts");
    expect(results[0]?.exactMatchRank).toBe(1);
    expect(results[0]?.bm25Rank).toBe(1);
    expect(results[0]?.vectorRank).toBe(2);
  });

  it("returns vector-ranked chunks when lexical search misses", async () => {
    const semantic = insertChunkFixture("src/oauth/callback.ts", "handleCallback", {
      signature: "function handleCallback()",
      chunkText: "oauth exchange token callback lifecycle",
    });

    const runtime = createRuntime([
      {
        chunkId: semantic.chunkId,
        fileId: semantic.fileId,
        filePath: "src/oauth/callback.ts",
        startLine: 1,
        endLine: 20,
        distance: 0.02,
        scopeChain: ["handleCallback"],
        entityNames: ["handleCallback"],
        tokenCount: 24,
      },
    ]);

    const results = await hybridSearch(db, runtime, {
      query: "oauth token lifecycle",
      queryTerms: ["oauth", "token", "lifecycle"],
      queryEmbedding: new Float32Array(384),
      projectRoot: "/repo",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.filePath).toBe("src/oauth/callback.ts");
    expect(results[0]?.symbolIds).toContain(semantic.symbolId);
    expect(results[0]?.vectorRank).toBe(1);
    expect(results[0]?.bm25Rank).toBeNull();
    expect(results[0]?.exactMatchRank).toBeNull();
  });

  it("respects path restrictions across fused results", async () => {
    const core = insertChunkFixture("src/core/runtime.ts", "runtimeCore");
    const ui = insertChunkFixture("src/ui/runtime-panel.tsx", "runtimePanel");

    const runtime = createRuntime([
      {
        chunkId: ui.chunkId,
        fileId: ui.fileId,
        filePath: "src/ui/runtime-panel.tsx",
        startLine: 1,
        endLine: 20,
        distance: 0.01,
        scopeChain: ["runtimePanel"],
        entityNames: ["runtimePanel"],
        tokenCount: 24,
      },
      {
        chunkId: core.chunkId,
        fileId: core.fileId,
        filePath: "src/core/runtime.ts",
        startLine: 1,
        endLine: 20,
        distance: 0.02,
        scopeChain: ["runtimeCore"],
        entityNames: ["runtimeCore"],
        tokenCount: 24,
      },
    ]);

    const results = await hybridSearch(db, runtime, {
      query: "runtime",
      queryTerms: ["runtime"],
      queryEmbedding: new Float32Array(384),
      projectRoot: "/repo",
      pathRestriction: "src/core",
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.filePath).toBe("src/core/runtime.ts");
  });

  it("adds recency bonuses without overpowering exact-match precision", async () => {
    const now = Date.now();
    const exact = insertChunkFixture("src/auth/user-service.ts", "UserService", {
      mtime: now - 14 * 24 * 60 * 60 * 1000,
    });
    const recent = insertChunkFixture("src/auth/runtime-flow.ts", "runtimeFlow", {
      mtime: now - 60 * 60 * 1000,
    });

    const runtime = createRuntime([
      {
        chunkId: recent.chunkId,
        fileId: recent.fileId,
        filePath: "src/auth/runtime-flow.ts",
        startLine: 1,
        endLine: 20,
        distance: 0.01,
        scopeChain: ["runtimeFlow"],
        entityNames: ["runtimeFlow"],
        tokenCount: 24,
      },
    ]);

    const results = await hybridSearch(db, runtime, {
      query: "UserService",
      queryTerms: ["UserService"],
      queryEmbedding: new Float32Array(384),
      projectRoot: "/repo",
      limit: 5,
    });

    expect(results[0]?.filePath).toBe("src/auth/user-service.ts");
    expect(results.find((entry) => entry.filePath === "src/auth/runtime-flow.ts")?.recencyScore).toBeGreaterThan(0);
  });
});
