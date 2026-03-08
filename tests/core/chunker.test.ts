import { describe, expect, it } from "vitest";
import { buildEmbeddingChunks } from "../../src/core/chunker.js";

describe("buildEmbeddingChunks", () => {
  it("produces contextualized chunks with scope, imports, and sibling metadata", async () => {
    const source = `import { Database } from "./db";

export class UserService {
  constructor(private readonly db: Database) {}

  async getUser(id: string) {
    return this.db.find(id);
  }

  formatUser(user: { id: string }) {
    return user.id.toUpperCase();
  }
}
`;

    const chunks = await buildEmbeddingChunks("src/user-service.ts", source, {
      maxChunkSize: 120,
    });

    expect(chunks.length).toBeGreaterThan(0);

    const getUserChunk = chunks.find((chunk) => chunk.entityNames.includes("getUser"));
    expect(getUserChunk).toBeDefined();
    expect(getUserChunk!.scopeChain).toContain("UserService");
    expect(getUserChunk!.importSources).toContain("./db");
    expect(getUserChunk!.contextualizedText).toContain("getUser");
    expect(getUserChunk!.tokenCount).toBeGreaterThan(0);
    expect(getUserChunk!.startLine).toBeGreaterThan(0);
    expect(getUserChunk!.endLine).toBeGreaterThanOrEqual(getUserChunk!.startLine);
    expect(chunks.some((chunk) => chunk.siblingNames.length > 0)).toBe(true);
  });

  it("maps TSX files onto a supported chunking language", async () => {
    const source = `export function DashboardCard() {
  return <section><h1>Usage</h1></section>;
}
`;

    const chunks = await buildEmbeddingChunks("src/DashboardCard.tsx", source);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.entityNames).toContain("DashboardCard");
  });

  it("returns no chunks for languages the AST chunker does not support", async () => {
    const chunks = await buildEmbeddingChunks("config/settings.yaml", "port: 3000\n");
    expect(chunks).toEqual([]);
  });
});
