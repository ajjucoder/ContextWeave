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
  | "jina:jina-embeddings-v3"
  | "voyage:voyage-code-3"
  | "none";

type RemoteEmbeddingProvider = "openai" | "jina" | "voyage";

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
  provider: RemoteEmbeddingProvider;
  apiModel: string;
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
  { provider: RemoteEmbeddingProvider; apiModel: string; dimensions: number }
> = {
  "openai:text-embedding-3-small": {
    provider: "openai",
    apiModel: "text-embedding-3-small",
    dimensions: 1536,
  },
  "jina:jina-embeddings-v3": {
    provider: "jina",
    apiModel: "jina-embeddings-v3",
    dimensions: 1024,
  },
  "voyage:voyage-code-3": {
    provider: "voyage",
    apiModel: "voyage-code-3",
    dimensions: 1024,
  },
};

interface RemoteProviderRuntimeSpec {
  endpoint: string;
  apiKeyEnvNames: string[];
}

const REMOTE_PROVIDER_RUNTIME: Record<RemoteEmbeddingProvider, RemoteProviderRuntimeSpec> = {
  openai: {
    endpoint: "https://api.openai.com/v1/embeddings",
    apiKeyEnvNames: ["OPENAI_API_KEY"],
  },
  jina: {
    endpoint: "https://api.jina.ai/v1/embeddings",
    apiKeyEnvNames: ["JINA_API_KEY", "JINAAI_API_KEY"],
  },
  voyage: {
    endpoint: "https://api.voyageai.com/v1/embeddings",
    apiKeyEnvNames: ["VOYAGE_API_KEY", "VOYAGEAI_API_KEY"],
  },
};

type RemoteEmbeddingPurpose = "query" | "document";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemoteEmbedderOptions {
  fetchImpl?: FetchLike;
  getEnv?: (name: string) => string | undefined;
}

class MissingApiKeyError extends Error {
  constructor(provider: RemoteEmbeddingProvider, envNames: string[]) {
    super(`Missing ${provider} API key; set one of ${envNames.join(", ")}`);
    this.name = "MissingApiKeyError";
  }
}

function resolveApiKey(spec: RemoteEmbeddingModelSpec, getEnv: (name: string) => string | undefined): string {
  const envNames = REMOTE_PROVIDER_RUNTIME[spec.provider].apiKeyEnvNames;
  for (const envName of envNames) {
    const value = getEnv(envName)?.trim();
    if (value) {
      return value;
    }
  }
  throw new MissingApiKeyError(spec.provider, envNames);
}

function buildRemoteRequestBody(
  spec: RemoteEmbeddingModelSpec,
  inputs: string[],
  purpose: RemoteEmbeddingPurpose
): Record<string, unknown> {
  switch (spec.provider) {
    case "openai":
      return {
        model: spec.apiModel,
        input: inputs,
        encoding_format: "float",
      };
    case "jina":
      return {
        model: spec.apiModel,
        input: inputs,
        embedding_type: "float",
      };
    case "voyage":
      return {
        model: spec.apiModel,
        input: inputs,
        input_type: purpose,
      };
  }
}

function coerceEmbedding(entry: unknown, dimensions: number): Float32Array {
  if (!entry || typeof entry !== "object" || !("embedding" in entry)) {
    throw new Error("Remote embedding response item is missing an embedding array");
  }

  const embedding = (entry as { embedding: unknown }).embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Remote embedding response item did not contain an embedding array");
  }
  if (embedding.length !== dimensions) {
    throw new Error(`Expected ${dimensions} embedding dimensions, received ${embedding.length}`);
  }

  const values = new Float32Array(dimensions);
  for (let index = 0; index < embedding.length; index += 1) {
    const value = embedding[index];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error("Remote embedding response contained a non-numeric value");
    }
    values[index] = value;
  }
  return values;
}

async function parseRemoteResponse(response: Response, expectedRows: number, dimensions: number): Promise<Float32Array[]> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json() as { data?: unknown };
  if (!Array.isArray(payload.data)) {
    throw new Error("Remote embedding API response did not include a data array");
  }
  if (payload.data.length !== expectedRows) {
    throw new Error(`Expected ${expectedRows} remote embedding row(s), received ${payload.data.length}`);
  }

  return payload.data.map((entry) => coerceEmbedding(entry, dimensions));
}

class RemoteEmbedder {
  constructor(
    private readonly spec: RemoteEmbeddingModelSpec,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike
  ) {}

  async embed(text: string): Promise<Float32Array> {
    const [embedding] = await this.embedInternal([text], "query");
    if (!embedding) {
      throw new Error("Remote embedding API returned no query embedding");
    }
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.embedInternal(texts, "document");
  }

  async dispose(): Promise<void> {}

  private async embedInternal(texts: string[], purpose: RemoteEmbeddingPurpose): Promise<Float32Array[]> {
    const provider = REMOTE_PROVIDER_RUNTIME[this.spec.provider];
    const response = await this.fetchImpl(provider.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(buildRemoteRequestBody(this.spec, texts, purpose)),
    });
    return parseRemoteResponse(response, texts.length, this.spec.dimensions);
  }
}

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

export function createRemoteEmbedderForModel(
  spec: RemoteEmbeddingModelSpec,
  options: RemoteEmbedderOptions = {}
): Pick<RemoteEmbedder, "embed" | "embedBatch" | "dispose"> {
  const getEnv = options.getEnv ?? ((name: string) => process.env[name]);
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = resolveApiKey(spec, getEnv);
  return new RemoteEmbedder(spec, apiKey, fetchImpl);
}
