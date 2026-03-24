import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { VectorStore } from "../../src/core/vector-store.js";

function toBuffer(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

function seedChunk(db: Database.Database, path: string, chunkIndex: number, entityName: string): number {
  const now = Date.now();
  const fileId = Number(
    db.prepare(
      "INSERT INTO files (path, basename, hash, last_indexed, mtime, language, symbol_count, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(path, path.split("/").pop() ?? path, `${path}:${chunkIndex}`, now, now, "typescript", 1, null).lastInsertRowid
  );

  return Number(
    db.prepare(`
      INSERT INTO chunks (
        file_id,
        chunk_index,
        start_line,
        end_line,
        start_byte,
        end_byte,
        text,
        contextualized_text,
        scope_chain,
        import_context,
        sibling_context,
        entity_context,
        token_count,
        content_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      chunkIndex,
      1 + chunkIndex,
      3 + chunkIndex,
      0,
      32,
      `function ${entityName}() {}`,
      `export function ${entityName}() {}`,
      JSON.stringify(["Service"]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([entityName]),
      12,
      `${entityName}-hash`,
      now
    ).lastInsertRowid
  );
}

describe("VectorStore", () => {
  it("stores embeddings in the same SQLite database and reports coverage stats", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const alphaChunkId = seedChunk(db, "src/alpha.ts", 0, "alpha");
    const betaChunkId = seedChunk(db, "src/beta.ts", 0, "beta");

    const store = new VectorStore(db, { dimensions: 3, modelName: "test-mini" });
    store.initialize();
    store.storeEmbedding(alphaChunkId, new Float32Array([1, 0, 0]));

    expect(store.hasEmbedding(alphaChunkId)).toBe(true);
    expect(store.hasEmbedding(betaChunkId)).toBe(false);
    expect(store.stats()).toEqual({
      total: 2,
      embedded: 1,
      pending: 1,
    });

    const stored = db
      .prepare("SELECT file_id, start_line, end_line, text_hash, model_name, vec_to_json(embedding) AS embedding FROM chunk_embeddings WHERE id = ?")
      .get(alphaChunkId) as {
        file_id: number;
        start_line: number;
        end_line: number;
        text_hash: string;
        model_name: string;
        embedding: string;
      };
    expect(stored.embedding).toBe("[1.000000,0.000000,0.000000]");
    expect(stored).toEqual({
      file_id: 1,
      start_line: 1,
      end_line: 3,
      text_hash: "alpha-hash",
      model_name: "test-mini",
      embedding: "[1.000000,0.000000,0.000000]",
    });

    db.close();
  });

  it("returns nearest neighbors ordered by cosine distance and supports file path filters", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const alphaChunkId = seedChunk(db, "src/alpha.ts", 0, "alpha");
    const betaChunkId = seedChunk(db, "src/beta.ts", 0, "beta");
    const gammaChunkId = seedChunk(db, "docs/gamma.ts", 0, "gamma");

    const store = new VectorStore(db, { dimensions: 3, modelName: "test-mini" });
    store.initialize();
    store.storeBatch([
      { chunkId: alphaChunkId, embedding: new Float32Array([1, 0, 0]) },
      { chunkId: betaChunkId, embedding: new Float32Array([0.9, 0.1, 0]) },
      { chunkId: gammaChunkId, embedding: new Float32Array([0, 1, 0]) },
    ]);

    const matches = store.search(new Float32Array([1, 0, 0]), 3);
    expect(matches.map((match) => match.chunkId)).toEqual([alphaChunkId, betaChunkId, gammaChunkId]);
    expect(matches[0]?.filePath).toBe("src/alpha.ts");
    expect(matches[0]?.entityNames).toEqual(["alpha"]);
    expect(matches[0]!.distance).toBeLessThan(matches[1]!.distance);
    expect(matches[1]!.distance).toBeLessThan(matches[2]!.distance);

    const filtered = store.searchWithFilter(new Float32Array([1, 0, 0]), "src/%", 5);
    expect(filtered.map((match) => match.filePath)).toEqual(["src/alpha.ts", "src/beta.ts"]);

    db.close();
  });

  it("rejects embeddings whose dimensions do not match the configured store", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);

    const chunkId = seedChunk(db, "src/alpha.ts", 0, "alpha");
    const store = new VectorStore(db, { dimensions: 3, modelName: "test-mini" });
    store.initialize();

    expect(() => store.storeEmbedding(chunkId, new Float32Array([1, 0]))).toThrow(/3/);

    db.close();
  });
});
