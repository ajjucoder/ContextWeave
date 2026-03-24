import type Database from "better-sqlite3";
import { VectorStore } from "./vector-store.js";
import { CrossEncoderReranker } from "./reranker.js";
import type { EmbeddingRuntime } from "./types.js";
import { createLogger } from "../utils/logger.js";
import {
  createLocalEmbedderForModel,
  createRemoteEmbedderForModel,
  resolveEmbeddingModel,
  type RemoteEmbedderOptions,
} from "./embedding-models.js";

const log = createLogger("embedding-runtime");

export async function createEmbeddingRuntime(
  db: Database.Database,
  options: { modelName?: string | undefined } & RemoteEmbedderOptions = {}
): Promise<EmbeddingRuntime | null> {
  const model = resolveEmbeddingModel(options.modelName);
  if (model.kind === "disabled") {
    return null;
  }

  try {
    const embedder =
      model.kind === "remote"
        ? createRemoteEmbedderForModel(model, options)
        : await createLocalEmbedderForModel(model);
    const vectorStore = new VectorStore(db, {
      dimensions: model.dimensions,
      modelName: model.configuredName,
    });
    vectorStore.initialize();

    let reranker: CrossEncoderReranker | undefined;
    try {
      reranker = new CrossEncoderReranker();
    } catch (err) {
      log.warn("cross-encoder reranker unavailable", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      embedder,
      vectorStore,
      reranker,
      modelName: model.configuredName,
    };
  } catch (error) {
    log.warn("embeddings unavailable; continuing with chunk-only indexing", {
      modelName: model.configuredName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function disposeEmbeddingRuntime(runtime: EmbeddingRuntime | null | undefined): Promise<void> {
  await runtime?.embedder.dispose?.();
  if (runtime?.reranker && "dispose" in runtime.reranker) {
    await (runtime.reranker as CrossEncoderReranker).dispose();
  }
}
