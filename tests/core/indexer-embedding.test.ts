import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexSingleFile } from "../../src/core/indexer.js";
import { VectorStore } from "../../src/core/vector-store.js";
import { loadConfig } from "../../src/utils/config.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-index-embeddings-"));
  tempRoots.push(root);
  return root;
}

function bumpMtime(filePath: string): void {
  const next = new Date(Date.now() + 5_000);
  utimesSync(filePath, next, next);
}

describe("indexer embedding integration", () => {
  it("stores embeddings for persisted chunks and re-embeds only changed files", async () => {
    const root = makeTempProject();
    const filePath = join(root, "user-service.ts");
    writeFileSync(
      filePath,
      `export function getUser(id: string) {
  return id.toUpperCase();
}
`
    );
    bumpMtime(filePath);

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const embedder = {
      embedBatch: vi.fn(async (texts: string[]) =>
        texts.map((text, index) => new Float32Array([
          text.includes("saveUser") ? 0 : 1,
          index + 1,
          text.length,
        ]))
      ),
    };
    const vectorStore = new VectorStore(db, { dimensions: 3 });

    const first = await indexSingleFile(db, filePath, root, undefined, {
      embeddings: {
        embedder,
        vectorStore,
        modelName: "mock-mini",
      },
    });

    expect(first.errors).toEqual([]);
    expect(embedder.embedBatch).toHaveBeenCalledTimes(1);
    const chunkCountAfterFirst = (
      db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }
    ).count;
    const embeddedAfterFirst = (
      db.prepare("SELECT COUNT(*) AS count FROM chunk_embeddings").get() as { count: number }
    ).count;
    expect(embeddedAfterFirst).toBe(chunkCountAfterFirst);

    const unchanged = await indexSingleFile(db, filePath, root, undefined, {
      embeddings: {
        embedder,
        vectorStore,
        modelName: "mock-mini",
      },
    });
    expect(unchanged.diff).toBeNull();
    expect(embedder.embedBatch).toHaveBeenCalledTimes(1);

    writeFileSync(
      filePath,
      `export function saveUser(id: string) {
  return id.trim();
}
`
    );
    bumpMtime(filePath);

    const second = await indexSingleFile(db, filePath, root, undefined, {
      embeddings: {
        embedder,
        vectorStore,
        modelName: "mock-mini",
      },
    });

    expect(second.errors).toEqual([]);
    expect(embedder.embedBatch).toHaveBeenCalledTimes(2);

    const currentChunkCount = (
      db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }
    ).count;
    const currentEmbeddedCount = (
      db.prepare("SELECT COUNT(*) AS count FROM chunk_embeddings").get() as { count: number }
    ).count;
    expect(currentEmbeddedCount).toBe(currentChunkCount);

    const storedModels = db
      .prepare("SELECT DISTINCT model_name FROM chunk_embeddings ORDER BY model_name")
      .all() as Array<{ model_name: string }>;
    expect(storedModels).toEqual([{ model_name: "mock-mini" }]);

    const matches = vectorStore.search(new Float32Array([0, 1, 50]), 5);
    expect(matches[0]?.entityNames).toContain("saveUser");

    db.close();
  });

  it("loads an embedding model override from project config", () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".contextweave"), { recursive: true });
    writeFileSync(
      join(root, ".contextweave", "config.json"),
      JSON.stringify({
        embeddingModel: "local/test-mini",
      })
    );

    const config = loadConfig(root);
    expect(config.embeddingModel).toBe("local/test-mini");
  });

  it("indexes markdown ADR files into BM25 and embedding chunks", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "docs", "ADR"), { recursive: true });
    const filePath = join(root, "docs", "ADR", "ADR-001-auth-tokens.md");
    writeFileSync(
      filePath,
      [
        "# ADR-001: Auth Tokens",
        "",
        "Use refresh tokens for session continuity.",
        "",
        "## Decision",
        "",
        "Store refresh tokens in HttpOnly cookies.",
        "",
      ].join("\n")
    );
    bumpMtime(filePath);

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const embedder = {
      embedBatch: vi.fn(async (texts: string[]) =>
        texts.map((text, index) => new Float32Array([
          text.includes("Decision") ? 1 : 0,
          index + 1,
          text.length,
        ]))
      ),
    };
    const vectorStore = new VectorStore(db, { dimensions: 3 });

    const result = await indexSingleFile(db, filePath, root, undefined, {
      embeddings: {
        embedder,
        vectorStore,
        modelName: "mock-mini",
      },
    });

    expect(result.errors).toEqual([]);
    expect(embedder.embedBatch).toHaveBeenCalledTimes(1);

    const storedChunks = db
      .prepare("SELECT COUNT(*) AS count FROM chunks")
      .get() as { count: number };
    const storedEmbeddings = db
      .prepare("SELECT COUNT(*) AS count FROM chunk_embeddings")
      .get() as { count: number };
    expect(storedChunks.count).toBeGreaterThan(0);
    expect(storedEmbeddings.count).toBe(storedChunks.count);

    const matches = vectorStore.search(new Float32Array([1, 1, 120]), 5);
    expect(matches[0]?.filePath).toBe("docs/ADR/ADR-001-auth-tokens.md");
    expect(matches[0]?.entityNames).toContain("Decision");

    db.close();
  });
});
