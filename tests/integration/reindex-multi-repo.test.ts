import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { registerReindexTool } from "../../src/mcp/tools/reindex.js";

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
  handler?: (args: { path?: string; paths?: string[] }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  tool: (
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: { path?: string; paths?: string[] }) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
  ) => void;
}

function makeWorkspaceFixture() {
  const workspace = mkdtempSync(join(tmpdir(), "cw-reindex-multi-"));
  tempRoots.push(workspace);

  const projectRoot = join(workspace, "host");
  const serviceA = join(workspace, "service-a");
  const serviceB = join(workspace, "service-b");

  mkdirSync(join(projectRoot, ".contextweave"), { recursive: true });
  mkdirSync(join(serviceA, "src"), { recursive: true });
  mkdirSync(join(serviceB, "src"), { recursive: true });

  writeFileSync(join(serviceA, "src", "a.ts"), "export const serviceA = 1;\n");
  writeFileSync(join(serviceB, "src", "b.ts"), "export const serviceB = 2;\n");

  return { projectRoot, serviceA, serviceB };
}

describe("multi-repo reindex tool", () => {
  it("accepts multiple root paths and stores repo metadata per indexed file", async () => {
    const { projectRoot } = makeWorkspaceFixture();
    const db = new Database(":memory:");
    runMigrations(db);

    const fakeServer: FakeToolServer = {
      tool(name, _description, _schema, handler) {
        if (name === "cw_reindex") {
          this.handler = handler;
        }
      },
    };

    registerReindexTool(fakeServer as unknown as McpServer, db, projectRoot);
    const result = await fakeServer.handler?.({ paths: ["../service-a", "../service-b"] });

    expect(result?.isError).not.toBe(true);
    expect(result?.content[0]?.text).toContain("repos");

    const files = fileQueries(db).getAll();
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.repo).sort()).toEqual(["../service-a", "../service-b"]);

    db.close();
  });
});
