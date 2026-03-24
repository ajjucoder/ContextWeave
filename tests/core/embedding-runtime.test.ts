import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../src/db/migrations.js";
import { createEmbeddingRuntime, disposeEmbeddingRuntime } from "../../src/core/embedding-runtime.js";

function buildVector(seed: number, dimensions: number): number[] {
  return Array.from({ length: dimensions }, (_, index) => seed + index / 1_000);
}

describe("embedding-runtime remote providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gracefully falls back when a remote model has no API key", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const runtime = await createEmbeddingRuntime(db, {
      modelName: "openai:text-embedding-3-small",
      getEnv: () => undefined,
      fetchImpl: vi.fn(),
    });

    expect(runtime).toBeNull();
    db.close();
  });

  it("creates a remote runtime when Voyage credentials are available", async () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const fetchImpl = vi.fn(async (_url: string, request?: RequestInit) => {
      const body = JSON.parse(String(request?.body)) as { input: string[]; input_type: string };
      expect(body.input).toEqual(["lookup query"]);
      expect(body.input_type).toBe("query");
      return new Response(
        JSON.stringify({
          data: [{ embedding: buildVector(0.25, 1024) }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });

    const runtime = await createEmbeddingRuntime(db, {
      modelName: "voyage:voyage-code-3",
      getEnv: (name) => (name === "VOYAGE_API_KEY" ? "voyage-test-key" : undefined),
      fetchImpl,
    });

    expect(runtime).not.toBeNull();
    expect(runtime?.modelName).toBe("voyage:voyage-code-3");
    await expect(runtime?.embedder.embed("lookup query")).resolves.toEqual(
      Float32Array.from(buildVector(0.25, 1024))
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await disposeEmbeddingRuntime(runtime);
    db.close();
  });
});
