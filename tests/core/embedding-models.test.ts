import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EMBEDDING_DIMENSIONS } from "../../src/core/embedder.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  createLocalEmbedderForModel,
  createRemoteEmbedderForModel,
  resolveEmbeddingModel,
} from "../../src/core/embedding-models.js";

function buildVector(seed: number, dimensions: number): Float32Array {
  const output = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    output[index] = seed + index / 1_000;
  }
  return output;
}

describe("embedding-models", () => {
  it("defaults config resolution to none", () => {
    expect(resolveEmbeddingModel(undefined)).toEqual({
      configuredName: "none",
      kind: "disabled",
    });
    expect(resolveEmbeddingModel(" none ")).toEqual({
      configuredName: "none",
      kind: "disabled",
    });
  });

  it("maps supported local models to concrete ONNX runtime specs", () => {
    expect(resolveEmbeddingModel("local:nomic-embed-code")).toEqual({
      configuredName: "local:nomic-embed-code",
      kind: "local",
      huggingFaceModelId: "nomic-ai/nomic-embed-code",
      dimensions: 768,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    });

    expect(resolveEmbeddingModel("local:jina-embeddings-v3")).toEqual({
      configuredName: "local:jina-embeddings-v3",
      kind: "local",
      huggingFaceModelId: "jinaai/jina-embeddings-v3",
      dimensions: 1024,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    });
  });

  it("keeps openai config opt-in but unresolved for this local-only runtime", () => {
    expect(resolveEmbeddingModel("openai:text-embedding-3-small")).toEqual({
      configuredName: "openai:text-embedding-3-small",
      kind: "remote",
      provider: "openai",
      apiModel: "text-embedding-3-small",
      dimensions: 1536,
    });
  });

  it("maps supported remote Jina and Voyage models to API specs", () => {
    expect(resolveEmbeddingModel("jina:jina-embeddings-v3")).toEqual({
      configuredName: "jina:jina-embeddings-v3",
      kind: "remote",
      provider: "jina",
      apiModel: "jina-embeddings-v3",
      dimensions: 1024,
    });

    expect(resolveEmbeddingModel("voyage:voyage-code-3")).toEqual({
      configuredName: "voyage:voyage-code-3",
      kind: "remote",
      provider: "voyage",
      apiModel: "voyage-code-3",
      dimensions: 1024,
    });
  });

  it("uses 64-item batch embedding for local models", async () => {
    const model = resolveEmbeddingModel("local:nomic-embed-code");
    if (model.kind !== "local") {
      throw new Error("expected local model");
    }

    const extractor = vi.fn(async (input: string | string[]) => {
      const rows = Array.isArray(input) ? input.length : 1;
      return {
        data: Float32Array.from(
          Array.from({ length: rows * model.dimensions }, (_, index) => index / 10)
        ),
        dims: [rows, model.dimensions],
      };
    });

    const embedder = await createLocalEmbedderForModel(model, {
      pipelineFactory: vi.fn(async () => extractor),
    });

    const inputs = Array.from({ length: 64 }, (_, index) => `symbol_${index}`);
    const vectors = await embedder.embedBatch(inputs);

    expect(extractor).toHaveBeenCalledTimes(1);
    expect(vectors).toHaveLength(64);
    expect(vectors[0]).toHaveLength(768);

    await embedder.dispose();
  });

  it("falls back to generic local model dimensions for custom local overrides", () => {
    expect(resolveEmbeddingModel("local:custom/test-model")).toEqual({
      configuredName: "local:custom/test-model",
      kind: "local",
      huggingFaceModelId: "custom/test-model",
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      batchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
    });
  });

  it("calls the OpenAI embeddings API for remote embeddings", async () => {
    const model = resolveEmbeddingModel("openai:text-embedding-3-small");
    if (model.kind !== "remote") {
      throw new Error("expected remote model");
    }

    const openAiResponse = {
      data: [
        { embedding: Array.from(buildVector(1, model.dimensions)) },
        { embedding: Array.from(buildVector(2, model.dimensions)) },
      ],
    };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(openAiResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const embedder = createRemoteEmbedderForModel(model, {
      getEnv: (name) => (name === "OPENAI_API_KEY" ? "openai-test-key" : undefined),
      fetchImpl,
    });

    const vectors = await embedder.embedBatch(["alpha", "beta"]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(request).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer openai-test-key",
      }),
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "text-embedding-3-small",
      input: ["alpha", "beta"],
      encoding_format: "float",
    });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(model.dimensions);
  });
});
