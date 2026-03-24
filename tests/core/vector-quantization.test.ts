import { describe, expect, it } from "vitest";
import {
  dequantizeInt8Embedding,
  quantizeEmbeddingToInt8,
  quantizedCosineDelta,
} from "../../src/core/vector-quantization.js";

describe("vector-quantization", () => {
  it("stores embeddings in 8-bit scalar quantized form at one quarter of the float32 size", () => {
    const embedding = new Float32Array([0.75, -0.5, 0.25, 0.125, -0.875, 0.375, 0.5, -0.25]);

    const quantized = quantizeEmbeddingToInt8(embedding);

    expect(quantized).toBeInstanceOf(Int8Array);
    expect(quantized.byteLength).toBe(embedding.byteLength / 4);
  });

  it("keeps cosine accuracy within one percent after quantization", () => {
    const query = new Float32Array([0.75, 0.2, -0.1, 0.55, -0.25, 0.4, 0.1, -0.6]);
    const candidate = new Float32Array([0.7, 0.18, -0.05, 0.6, -0.2, 0.35, 0.05, -0.55]);

    const quantizedCandidate = quantizeEmbeddingToInt8(candidate);
    const restoredCandidate = dequantizeInt8Embedding(quantizedCandidate);

    expect(quantizedCosineDelta(query, restoredCandidate, candidate)).toBeLessThan(0.01);
  });
});
