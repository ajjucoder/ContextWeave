/**
 * Helpers for 8-bit scalar quantization of embeddings before SQLite persistence.
 */

const INT8_SCALE = 127;

function l2Norm(embedding: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < embedding.length; index += 1) {
    const value = embedding[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

export function normalizeEmbedding(embedding: Float32Array): Float32Array {
  const norm = l2Norm(embedding);
  if (norm === 0) {
    return new Float32Array(embedding.length);
  }

  const normalized = new Float32Array(embedding.length);
  for (let index = 0; index < embedding.length; index += 1) {
    normalized[index] = (embedding[index] ?? 0) / norm;
  }
  return normalized;
}

export function quantizeEmbeddingToInt8(embedding: Float32Array): Int8Array {
  const normalized = normalizeEmbedding(embedding);
  const quantized = new Int8Array(normalized.length);
  for (let index = 0; index < normalized.length; index += 1) {
    const value = Math.max(-1, Math.min(1, normalized[index] ?? 0));
    quantized[index] = Math.round(value * INT8_SCALE);
  }
  return quantized;
}

export function dequantizeInt8Embedding(embedding: Int8Array): Float32Array {
  const restored = new Float32Array(embedding.length);
  for (let index = 0; index < embedding.length; index += 1) {
    restored[index] = (embedding[index] ?? 0) / INT8_SCALE;
  }
  return restored;
}

export function embeddingBufferToFloat32(buffer: Buffer, dimensions: number): Float32Array {
  if (buffer.length === dimensions) {
    return dequantizeInt8Embedding(new Int8Array(buffer));
  }

  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(bytes);
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  const cosine = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return Math.max(0, Math.min(1, cosine));
}

export function quantizedCosineDelta(
  query: Float32Array,
  quantizedCandidate: Float32Array,
  floatCandidate: Float32Array
): number {
  return Math.abs(cosineSimilarity(query, quantizedCandidate) - cosineSimilarity(query, floatCandidate));
}
