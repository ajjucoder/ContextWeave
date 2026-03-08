import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { ChunkEmbeddingEntry, VectorSearchResult, VectorStoreStats } from "./types.js";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "./embedder.js";

interface VectorStoreOptions {
  dimensions?: number;
}

const loadedExtensions = new WeakSet<Database.Database>();

function toVectorBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(
    embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength)
  );
}

function mapSearchResult(row: Record<string, unknown>): VectorSearchResult {
  return {
    chunkId: row["chunk_id"] as number,
    fileId: row["file_id"] as number,
    filePath: row["file_path"] as string,
    startLine: row["start_line"] as number,
    endLine: row["end_line"] as number,
    distance: Number(row["distance"] as number),
    scopeChain: JSON.parse((row["scope_chain"] as string) || "[]") as string[],
    entityNames: JSON.parse((row["entity_context"] as string) || "[]") as string[],
    tokenCount: row["token_count"] as number,
  };
}

export class VectorStore {
  private readonly dimensions: number;

  constructor(
    private readonly db: Database.Database,
    options: VectorStoreOptions = {}
  ) {
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  }

  initialize(): void {
    if (!loadedExtensions.has(this.db)) {
      sqliteVec.load(this.db);
      loadedExtensions.add(this.db);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        chunk_id    INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
        embedding   BLOB    NOT NULL,
        dimensions  INTEGER NOT NULL DEFAULT ${DEFAULT_EMBEDDING_DIMENSIONS},
        updated_at  INTEGER NOT NULL
      );
    `);
  }

  storeEmbedding(chunkId: number, embedding: Float32Array): void {
    this.initialize();
    this.validateEmbedding(embedding);
    this.db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, embedding, dimensions, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        embedding = excluded.embedding,
        dimensions = excluded.dimensions,
        updated_at = excluded.updated_at
    `).run(chunkId, toVectorBuffer(embedding), this.dimensions, Date.now());
  }

  storeBatch(entries: ChunkEmbeddingEntry[]): void {
    this.initialize();
    const insert = this.db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, embedding, dimensions, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        embedding = excluded.embedding,
        dimensions = excluded.dimensions,
        updated_at = excluded.updated_at
    `);

    const writeAll = this.db.transaction((rows: ChunkEmbeddingEntry[]) => {
      const now = Date.now();
      for (const row of rows) {
        this.validateEmbedding(row.embedding);
        insert.run(row.chunkId, toVectorBuffer(row.embedding), this.dimensions, now);
      }
    });

    writeAll(entries);
  }

  search(queryEmbedding: Float32Array, limit = 20): VectorSearchResult[] {
    return this.searchWithFilter(queryEmbedding, undefined, limit);
  }

  searchWithFilter(
    queryEmbedding: Float32Array,
    pathFilter?: string,
    limit = 20
  ): VectorSearchResult[] {
    this.initialize();
    this.validateEmbedding(queryEmbedding);
    const vector = toVectorBuffer(queryEmbedding);

    const rows = pathFilter
      ? this.db.prepare(`
          SELECT
            ce.chunk_id,
            c.file_id,
            f.path AS file_path,
            c.start_line,
            c.end_line,
            vec_distance_cosine(ce.embedding, ?) AS distance,
            c.scope_chain,
            c.entity_context,
            c.token_count
          FROM chunk_embeddings ce
          INNER JOIN chunks c ON c.id = ce.chunk_id
          INNER JOIN files f ON f.id = c.file_id
          WHERE f.path LIKE ? ESCAPE '\\'
          ORDER BY distance ASC, ce.chunk_id ASC
          LIMIT ?
        `).all(vector, pathFilter, limit)
      : this.db.prepare(`
          SELECT
            ce.chunk_id,
            c.file_id,
            f.path AS file_path,
            c.start_line,
            c.end_line,
            vec_distance_cosine(ce.embedding, ?) AS distance,
            c.scope_chain,
            c.entity_context,
            c.token_count
          FROM chunk_embeddings ce
          INNER JOIN chunks c ON c.id = ce.chunk_id
          INNER JOIN files f ON f.id = c.file_id
          ORDER BY distance ASC, ce.chunk_id ASC
          LIMIT ?
        `).all(vector, limit);

    return rows.map((row) => mapSearchResult(row as Record<string, unknown>));
  }

  hasEmbedding(chunkId: number): boolean {
    this.initialize();
    const row = this.db.prepare("SELECT 1 FROM chunk_embeddings WHERE chunk_id = ?").get(chunkId);
    return !!row;
  }

  stats(): VectorStoreStats {
    this.initialize();
    return this.db.prepare(`
      SELECT
        COUNT(c.id) AS total,
        COUNT(ce.chunk_id) AS embedded,
        COUNT(c.id) - COUNT(ce.chunk_id) AS pending
      FROM chunks c
      LEFT JOIN chunk_embeddings ce ON ce.chunk_id = c.id
    `).get() as VectorStoreStats;
  }

  private validateEmbedding(embedding: Float32Array): void {
    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Expected ${this.dimensions}-dimensional embedding, received ${embedding.length}`
      );
    }
  }
}
