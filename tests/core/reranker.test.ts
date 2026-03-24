import { describe, it, expect } from "vitest";
import {
  DEFAULT_RERANKER_ALPHA,
  DEFAULT_RERANKER_MODEL,
  CrossEncoderReranker,
  blendRerankerScore,
  resolveRerankerModel,
} from "../../src/core/reranker.js";

describe("CrossEncoderReranker", () => {
  it("defaults config resolution to none", () => {
    expect(resolveRerankerModel(undefined)).toEqual({
      configuredName: "none",
      kind: "disabled",
    });
    expect(resolveRerankerModel(" none ")).toEqual({
      configuredName: "none",
      kind: "disabled",
    });
  });

  it("maps the opt-in local reranker model to the ONNX checkpoint", () => {
    expect(resolveRerankerModel("local:bge-reranker-base")).toEqual({
      configuredName: "local:bge-reranker-base",
      kind: "local",
      huggingFaceModelId: "Xenova/bge-reranker-base",
      maxCandidates: 80,
      alpha: DEFAULT_RERANKER_ALPHA,
    });
    expect(DEFAULT_RERANKER_MODEL).toBe("none");
  });

  it("blends stage-a and cross-encoder scores using alpha", () => {
    expect(blendRerankerScore(0.8, 0.2, 0.25)).toBeCloseTo(0.35);
    expect(blendRerankerScore(0.8, 0.2, 0)).toBeCloseTo(0.2);
    expect(blendRerankerScore(0.8, 0.2, 1)).toBeCloseTo(0.8);
  });

  it("returns empty array for empty documents", async () => {
    const reranker = new CrossEncoderReranker({
      modelName: "Xenova/bge-reranker-base",
    });
    const results = await reranker.rerank("test query", []);
    expect(results).toEqual([]);
  });
});
