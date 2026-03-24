import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type { ChunkEmbeddingEntry, VectorSearchResult, VectorStoreStats } from "./types.js";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "./embedder.js";

interface VectorStoreOptions {
  dimensions?: number;
  modelName?: string;
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
  private readonly modelName: string;

  constructor(
    private readonly db: Database.Database,
    options: VectorStoreOptions = {}
  ) {
    this.dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
    this.modelName = options.modelName ?? "unknown";
  }

  initialize(): void {
    if (!loadedExtensions.has(this.db)) {
      sqliteVec.load(this.db);
      loadedExtensions.add(this.db);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        id          INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
        file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        start_line  INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        text_hash   TEXT    NOT NULL,
        embedding   BLOB    NOT NULL,
        model_name  TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_file_model ON chunk_embeddings(file_id, model_name);
      CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_text_hash ON chunk_embeddings(text_hash);
    `);
  }

  storeEmbedding(chunkId: number, embedding: Float32Array): void {
    this.initialize();
    this.validateEmbedding(embedding);
    const chunkMetadata = this.getChunkMetadata(chunkId);
    this.db.prepare(`
      INSERT INTO chunk_embeddings (id, file_id, start_line, end_line, text_hash, embedding, model_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_id = excluded.file_id,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        text_hash = excluded.text_hash,
        embedding = excluded.embedding,
        model_name = excluded.model_name
    `).run(
      chunkId,
      chunkMetadata.fileId,
      chunkMetadata.startLine,
      chunkMetadata.endLine,
      chunkMetadata.textHash,
      toVectorBuffer(embedding),
      this.modelName
    );
  }

  storeBatch(entries: ChunkEmbeddingEntry[]): void {
    this.initialize();
    const insert = this.db.prepare(`
      INSERT INTO chunk_embeddings (id, file_id, start_line, end_line, text_hash, embedding, model_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_id = excluded.file_id,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        text_hash = excluded.text_hash,
        embedding = excluded.embedding,
        model_name = excluded.model_name
    `);

    const writeAll = this.db.transaction((rows: ChunkEmbeddingEntry[]) => {
      for (const row of rows) {
        this.validateEmbedding(row.embedding);
        const chunkMetadata = this.getChunkMetadata(row.chunkId, row);
        insert.run(
          row.chunkId,
          chunkMetadata.fileId,
          chunkMetadata.startLine,
          chunkMetadata.endLine,
          chunkMetadata.textHash,
          toVectorBuffer(row.embedding),
          chunkMetadata.modelName
        );
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
            ce.id AS chunk_id,
            ce.file_id,
            f.path AS file_path,
            ce.start_line,
            ce.end_line,
            vec_distance_cosine(ce.embedding, ?) AS distance,
            c.scope_chain,
            c.entity_context,
            c.token_count
          FROM chunk_embeddings ce
          INNER JOIN chunks c ON c.id = ce.id
          INNER JOIN files f ON f.id = ce.file_id
          WHERE f.path LIKE ? ESCAPE '\\'
          ORDER BY distance ASC, ce.id ASC
          LIMIT ?
        `).all(vector, pathFilter, limit)
      : this.db.prepare(`
          SELECT
            ce.id AS chunk_id,
            ce.file_id,
            f.path AS file_path,
            ce.start_line,
            ce.end_line,
            vec_distance_cosine(ce.embedding, ?) AS distance,
            c.scope_chain,
            c.entity_context,
            c.token_count
          FROM chunk_embeddings ce
          INNER JOIN chunks c ON c.id = ce.id
          INNER JOIN files f ON f.id = ce.file_id
          ORDER BY distance ASC, ce.id ASC
          LIMIT ?
        `).all(vector, limit);

    return rows.map((row) => mapSearchResult(row as Record<string, unknown>));
  }

  hasEmbedding(chunkId: number): boolean {
    this.initialize();
    const row = this.db.prepare("SELECT 1 FROM chunk_embeddings WHERE id = ?").get(chunkId);
    return !!row;
  }

  stats(): VectorStoreStats {
    this.initialize();
    return this.db.prepare(`
      SELECT
        COUNT(c.id) AS total,
        COUNT(ce.id) AS embedded,
        COUNT(c.id) - COUNT(ce.id) AS pending
      FROM chunks c
      LEFT JOIN chunk_embeddings ce ON ce.id = c.id
    `).get() as VectorStoreStats;
  }

  private getChunkMetadata(
    chunkId: number,
    entry?: ChunkEmbeddingEntry
  ): { fileId: number; startLine: number; endLine: number; textHash: string; modelName: string } {
    if (
      typeof entry?.fileId === "number" &&
      typeof entry.startLine === "number" &&
      typeof entry.endLine === "number" &&
      typeof entry.textHash === "string"
    ) {
      return {
        fileId: entry.fileId,
        startLine: entry.startLine,
        endLine: entry.endLine,
        textHash: entry.textHash,
        modelName: entry.modelName ?? this.modelName,
      };
    }

    const row = this.db.prepare(`
      SELECT file_id, start_line, end_line, content_hash
      FROM chunks
      WHERE id = ?
    `).get(chunkId) as
      | { file_id: number; start_line: number; end_line: number; content_hash: string }
      | undefined;

    if (!row) {
      throw new Error(`Missing chunk metadata for embedding row ${chunkId}`);
    }

    return {
      fileId: row.file_id,
      startLine: row.start_line,
      endLine: row.end_line,
      textHash: row.content_hash,
      modelName: entry?.modelName ?? this.modelName,
    };
  }

  private validateEmbedding(embedding: Float32Array): void {
    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Expected ${this.dimensions}-dimensional embedding, received ${embedding.length}`
      );
    }
  }
}
