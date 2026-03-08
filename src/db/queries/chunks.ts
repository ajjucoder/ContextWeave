import type Database from "better-sqlite3";
import type { ChunkRecord, PreparedChunk } from "../../core/types.js";

type ChunkQueriesResult = ReturnType<typeof chunkQueriesImpl>;
const chunkQueriesCache = new WeakMap<Database.Database, ChunkQueriesResult>();

export function chunkQueries(db: Database.Database): ChunkQueriesResult {
  const cached = chunkQueriesCache.get(db);
  if (cached) return cached;
  const result = chunkQueriesImpl(db);
  chunkQueriesCache.set(db, result);
  return result;
}

function chunkQueriesImpl(db: Database.Database) {
  const deleteByFileId = db.prepare("DELETE FROM chunks WHERE file_id = ?");
  const insert = db.prepare(`
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
    ) VALUES (
      @fileId,
      @chunkIndex,
      @startLine,
      @endLine,
      @startByte,
      @endByte,
      @text,
      @contextualizedText,
      @scopeChain,
      @importSources,
      @siblingNames,
      @entityNames,
      @tokenCount,
      @contentHash,
      @createdAt
    )
  `);
  const getByFileId = db.prepare("SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index");
  const countByFileId = db.prepare("SELECT COUNT(*) as count FROM chunks WHERE file_id = ?");
  const countAll = db.prepare("SELECT COUNT(*) as count FROM chunks");

  function mapRow(row: unknown): ChunkRecord | undefined {
    if (!row) return undefined;
    const record = row as Record<string, unknown>;
    return {
      id: record["id"] as number,
      fileId: record["file_id"] as number,
      chunkIndex: record["chunk_index"] as number,
      startLine: record["start_line"] as number,
      endLine: record["end_line"] as number,
      startByte: record["start_byte"] as number,
      endByte: record["end_byte"] as number,
      text: record["text"] as string,
      contextualizedText: record["contextualized_text"] as string,
      scopeChain: JSON.parse((record["scope_chain"] as string) || "[]") as string[],
      importSources: JSON.parse((record["import_context"] as string) || "[]") as string[],
      siblingNames: JSON.parse((record["sibling_context"] as string) || "[]") as string[],
      entityNames: JSON.parse((record["entity_context"] as string) || "[]") as string[],
      tokenCount: record["token_count"] as number,
      contentHash: record["content_hash"] as string,
      createdAt: record["created_at"] as number,
    };
  }

  return {
    replaceForFile(fileId: number, chunks: PreparedChunk[], createdAt = Date.now()): void {
      deleteByFileId.run(fileId);
      for (const chunk of chunks) {
        insert.run({
          fileId,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          startByte: chunk.startByte,
          endByte: chunk.endByte,
          text: chunk.text,
          contextualizedText: chunk.contextualizedText,
          scopeChain: JSON.stringify(chunk.scopeChain),
          importSources: JSON.stringify(chunk.importSources),
          siblingNames: JSON.stringify(chunk.siblingNames),
          entityNames: JSON.stringify(chunk.entityNames),
          tokenCount: chunk.tokenCount,
          contentHash: chunk.contentHash,
          createdAt,
        });
      }
    },

    getByFileId(fileId: number): ChunkRecord[] {
      return getByFileId.all(fileId).map(mapRow).filter(Boolean) as ChunkRecord[];
    },

    countByFileId(fileId: number): number {
      return (countByFileId.get(fileId) as { count: number }).count;
    },

    count(): number {
      return (countAll.get() as { count: number }).count;
    },
  };
}
