import type Database from "better-sqlite3";
import { LocalEmbedder } from "./embedder.js";
import { VectorStore } from "./vector-store.js";
import type { EmbeddingRuntime } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("embedding-runtime");

export async function createEmbeddingRuntime(
  db: Database.Database,
  options: { modelName?: string | undefined } = {}
): Promise<EmbeddingRuntime | null> {
  if (!options.modelName) return null;

  try {
    const embedder = await LocalEmbedder.create({
      modelName: options.modelName,
    });
    const vectorStore = new VectorStore(db);
    vectorStore.initialize();

    return {
      embedder,
      vectorStore,
      modelName: options.modelName,
    };
  } catch (error) {
    log.warn("embeddings unavailable; continuing with chunk-only indexing", {
      modelName: options.modelName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function disposeEmbeddingRuntime(runtime: EmbeddingRuntime | null | undefined): Promise<void> {
  await runtime?.embedder.dispose?.();
}
