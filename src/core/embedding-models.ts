import { LocalEmbedder, DEFAULT_EMBEDDING_DIMENSIONS, type EmbedderOptions } from "./embedder.js";

/**
 * Registry and helpers for opt-in embedding model configuration.
 */
export const DEFAULT_EMBEDDING_MODEL = "none";
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

export type SupportedEmbeddingModel =
  | "local:nomic-embed-code"
  | "local:jina-embeddings-v3"
  | "openai:text-embedding-3-small"
  | "none";

export interface DisabledEmbeddingModelSpec {
  configuredName: string;
  kind: "disabled";
}

export interface LocalEmbeddingModelSpec {
  configuredName: string;
  kind: "local";
  huggingFaceModelId: string;
  dimensions: number;
  batchSize: number;
}

export interface RemoteEmbeddingModelSpec {
  configuredName: string;
  kind: "remote";
  provider: "openai";
  apiModel: "text-embedding-3-small";
  dimensions: number;
}

export type EmbeddingModelSpec =
  | DisabledEmbeddingModelSpec
  | LocalEmbeddingModelSpec
  | RemoteEmbeddingModelSpec;

const LOCAL_MODEL_SPECS: Record<string, { huggingFaceModelId: string; dimensions: number }> = {
  "local:nomic-embed-code": {
    huggingFaceModelId: "nomic-ai/nomic-embed-code",
    dimensions: 768,
  },
  "local:jina-embeddings-v3": {
    huggingFaceModelId: "jinaai/jina-embeddings-v3",
    dimensions: 1024,
  },
};

const REMOTE_MODEL_SPECS: Record<
  string,
  { provider: "openai"; apiModel: "text-embedding-3-small"; dimensions: number }
> = {
  "openai:text-embedding-3-small": {
    provider: "openai",
    apiModel: "text-embedding-3-small",
    dimensions: 1536,
  },
};

export function resolveEmbeddingModel(modelName?: string | null): EmbeddingModelSpec {
  const configuredName = modelName?.trim() || DEFAULT_EMBEDDING_MODEL;
  if (configuredName === "none") {
    return {
      configuredName,
      kind: "disabled",
    };
  }

  const local = LOCAL_MODEL_SPECS[configuredName];
  if (local) {
    return {
      configuredName,
      kind: "local",
      huggingFaceModelId: local.huggingFaceModelId,
      dimensions: local.dimensions,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    };
  }

  const remote = REMOTE_MODEL_SPECS[configuredName];
  if (remote) {
    return {
      configuredName,
      kind: "remote",
      provider: remote.provider,
      apiModel: remote.apiModel,
      dimensions: remote.dimensions,
    };
  }

  if (configuredName.startsWith("local:")) {
    return {
      configuredName,
      kind: "local",
      huggingFaceModelId: configuredName.slice("local:".length),
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    };
  }

  return {
    configuredName,
    kind: "disabled",
  };
}

export async function createLocalEmbedderForModel(
  spec: LocalEmbeddingModelSpec,
  options: Omit<EmbedderOptions, "modelName" | "dimensions" | "batchSize"> = {}
): Promise<LocalEmbedder> {
  return LocalEmbedder.create({
    ...options,
    modelName: spec.huggingFaceModelId,
    dimensions: spec.dimensions,
    batchSize: spec.batchSize,
  });
}
