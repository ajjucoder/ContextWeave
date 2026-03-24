import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { registerReadTool } from "../../src/mcp/tools/read.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: unknown) => Promise<ToolResult>;
};

function getTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

let db: Database.Database;
let fixtureRoot: string;
let sharedSessionServer: McpServer;
let freshSessionServer: McpServer;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "cw-read-budget-"));
  writeFileSync(
    join(fixtureRoot, "budget.ts"),
    [
      "export const line1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';",
      "export const line2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';",
      "export const line3 = 'cccccccccccccccccccccccccccccc';",
      "export const line4 = 'dddddddddddddddddddddddddddddd';",
    ].join("\n"),
    "utf-8"
  );

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);

  sharedSessionServer = new McpServer({ name: "contextweave-read-budget-shared", version: "0.0.0" });
  registerReadTool(sharedSessionServer, db, fixtureRoot, "budget-session-a", 120);

  freshSessionServer = new McpServer({ name: "contextweave-read-budget-fresh", version: "0.0.0" });
  registerReadTool(freshSessionServer, db, fixtureRoot, "budget-session-b", 120);
});

afterAll(() => {
  db.close();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("cw_read per-session character budget", () => {
  it("tracks cumulative chars per session and truncates once the budget is exceeded", async () => {
    const firstRead = await getTool(sharedSessionServer, "cw_read").handler({
      path: "budget.ts",
      start_line: 1,
      end_line: 1,
      max_lines: 1,
    });
    const firstText = firstRead.content[0]?.text ?? "";

    expect(firstRead.isError).not.toBe(true);
    expect(firstText).not.toContain("Budget exceeded");
    expect(firstText).toContain("line1");

    const secondRead = await getTool(sharedSessionServer, "cw_read").handler({
      path: "budget.ts",
      start_line: 2,
      end_line: 4,
      max_lines: 3,
    });
    const secondText = secondRead.content[0]?.text ?? "";

    expect(secondRead.isError).not.toBe(true);
    expect(secondText).toContain("Warning: Budget exceeded");
    expect(secondText).toContain("line2");
    expect(secondText).not.toContain("line4");
  });

  it("isolates read budgets by session", async () => {
    const result = await getTool(freshSessionServer, "cw_read").handler({
      path: "budget.ts",
      start_line: 2,
      end_line: 3,
      max_lines: 2,
    });
    const text = result.content[0]?.text ?? "";

    expect(result.isError).not.toBe(true);
    expect(text).not.toContain("Budget exceeded");
    expect(text).toContain("line2");
    expect(text).toContain("line3");
  });
});
