import { describe, it, expect } from "vitest";
import { CrossEncoderReranker } from "../../src/core/reranker.js";

describe("CrossEncoderReranker", () => {
  it("returns empty array for empty documents", async () => {
    const reranker = new CrossEncoderReranker();
    const results = await reranker.rerank("test query", []);
    expect(results).toEqual([]);
  });

  it("returns results with index and score for non-empty documents", async () => {
    const reranker = new CrossEncoderReranker({ topK: 3 });
    const documents = [
      "function handleAuth(user: User): Token",
      "function renderButton(): JSX.Element",
      "function validateEmail(email: string): boolean",
    ];

    const results = await reranker.rerank("authentication handler", documents);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const result of results) {
      expect(result).toHaveProperty("index");
      expect(result).toHaveProperty("score");
      expect(typeof result.index).toBe("number");
      expect(typeof result.score).toBe("number");
    }
  });

  it("gracefully handles model loading failures", async () => {
    const reranker = new CrossEncoderReranker({
      modelName: "nonexistent/model-that-does-not-exist-12345",
    });
    const results = await reranker.rerank("test", ["doc1", "doc2"]);
    expect(results.length).toBe(2);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(1);
  });

  it("results are sorted by score descending", async () => {
    const reranker = new CrossEncoderReranker({ topK: 5 });
    const documents = [
      "completely unrelated function for UI rendering",
      "authentication middleware for JWT tokens",
      "database migration script v42",
      "JWT token validation and refresh handler",
      "color palette utility for theme management",
    ];

    const results = await reranker.rerank("JWT authentication token validation", documents);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
    }
  });
});
