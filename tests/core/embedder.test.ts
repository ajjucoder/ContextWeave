import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_DTYPE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DEVICE,
  LocalEmbedder,
  type EmbedderOptions,
} from "../../src/core/embedder.js";

interface FakeTensor {
  data: Float32Array;
  dims: number[];
}

function buildVector(seed: number, dimensions = DEFAULT_EMBEDDING_DIMENSIONS): Float32Array {
  const output = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    output[index] = seed + index / 1_000;
  }
  return output;
}

function buildBatchTensor(vectors: Float32Array[]): FakeTensor {
  const data = new Float32Array(vectors.reduce((total, vector) => total + vector.length, 0));
  let offset = 0;
  for (const vector of vectors) {
    data.set(vector, offset);
    offset += vector.length;
  }
  return {
    data,
    dims: [vectors.length, vectors[0]?.length ?? 0],
  };
}

describe("LocalEmbedder", () => {
  it("creates a local MiniLM feature extractor with local-first defaults", async () => {
    const extractor = vi.fn(async () => ({
      data: buildVector(1),
      dims: [1, DEFAULT_EMBEDDING_DIMENSIONS],
    }));
    extractor.dispose = vi.fn(async () => undefined);

    const pipelineFactory = vi.fn(async () => extractor);

    const embedder = await LocalEmbedder.create({
      pipelineFactory,
    } satisfies EmbedderOptions);

    expect(pipelineFactory).toHaveBeenCalledWith(
      "feature-extraction",
      DEFAULT_EMBEDDING_MODEL,
      expect.objectContaining({
        dtype: DEFAULT_EMBEDDING_DTYPE,
        device: DEFAULT_EMBEDDING_DEVICE,
      })
    );

    const vector = await embedder.embed("export function listUsers() {}");
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector).toHaveLength(DEFAULT_EMBEDDING_DIMENSIONS);
    expect(vector[0]).toBeCloseTo(1);

    await embedder.dispose();
    expect(extractor.dispose).toHaveBeenCalledTimes(1);
  });

  it("embeds batches in stable 384-dimensional slices and honors batch size", async () => {
    const first = buildVector(1);
    const second = buildVector(2);
    const third = buildVector(3);

    const extractor = vi.fn(async (input: string | string[]) => {
      if (Array.isArray(input) && input.length === 2) {
        return buildBatchTensor([first, second]);
      }
      if (Array.isArray(input) && input.length === 1) {
        return buildBatchTensor([third]);
      }
      throw new Error(`unexpected batch: ${JSON.stringify(input)}`);
    });

    const embedder = await LocalEmbedder.create({
      batchSize: 2,
      pipelineFactory: vi.fn(async () => extractor),
    } satisfies EmbedderOptions);

    const vectors = await embedder.embedBatch([
      "function alpha() {}",
      "function beta() {}",
      "function gamma() {}",
    ]);

    expect(extractor).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(3);
    expect(vectors.every((vector) => vector.length === DEFAULT_EMBEDDING_DIMENSIONS)).toBe(true);
    expect(vectors[0]?.[0]).toBeCloseTo(1);
    expect(vectors[1]?.[0]).toBeCloseTo(2);
    expect(vectors[2]?.[0]).toBeCloseTo(3);
  });

  it("rejects extractor output when the embedding dimensions do not match the configured model", async () => {
    const embedder = await LocalEmbedder.create({
      pipelineFactory: vi.fn(async () => vi.fn(async () => ({
        data: new Float32Array(128),
        dims: [1, 128],
      }))),
    } satisfies EmbedderOptions);

    await expect(embedder.embed("const broken = true")).rejects.toThrow(/384/);
  });
});
