import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { registerReindexTool } from "../../src/mcp/tools/reindex.js";
import { runReindex } from "../../src/cli/commands/reindex.js";

vi.mock("../../src/core/graph.js", () => ({
  runPageRankInBackground: vi.fn(),
}));

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

interface FakeToolServer {
  handler?: (args: { path?: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  tool: (
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: { path?: string }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
  ) => void;
}

function makeProjectFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-reindex-"));
  tempRoots.push(root);

  mkdirSync(join(root, ".contextweave"), { recursive: true });
  mkdirSync(join(root, "src", "sub"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), "export const main = 1;\n");
  writeFileSync(join(root, "src", "sub", "feature.ts"), "export function feature() { return main + 1; }\n");

  return root;
}

describe("directory reindex", () => {
  it("reindexes a directory path via MCP tool", async () => {
    const projectRoot = makeProjectFixture();
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);

    const fakeServer: FakeToolServer = {
      tool(name, _description, _schema, handler) {
        if (name === "cw_reindex") {
          this.handler = handler;
        }
      },
    };

    registerReindexTool(fakeServer as unknown as McpServer, db, projectRoot);
    const result = await fakeServer.handler?.({ path: "src" });

    expect(result?.isError).not.toBe(true);
    expect(result?.content[0]?.text).toContain("files");
    expect(fileQueries(db).count()).toBeGreaterThan(0);

    db.close();
  });

  it("reindexes a directory path via CLI command", async () => {
    const projectRoot = makeProjectFixture();

    await runReindex(projectRoot, "src");

    const dbPath = resolve(projectRoot, ".contextweave", "contextweave.db");
    const db = new Database(dbPath);
    const files = fileQueries(db).getAll();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.path.startsWith("src/") || file.path.startsWith("src\\"))).toBe(true);
    db.close();
  });
});
