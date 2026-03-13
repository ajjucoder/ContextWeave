import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { registerOverviewTool } from "../../src/mcp/tools/overview.js";

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
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

let db: Database.Database;
let server: McpServer;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cw-overview-noncode-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(
    join(root, "docs", "partner-policy.md"),
    "# Partner Policy\n\nDistrict approval is required before auto-enrollment can start for partner schools.\nPartner rules must be verified before eligibility updates run.\n"
  );
  writeFileSync(
    join(root, "src", "eligibility.ts"),
    "export function evaluatePartnerEligibility(partnerId: string) { return partnerId.length > 0; }\n"
  );

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, root);
  updateCentralityScores(db);

  server = new McpServer({ name: "contextweave-test", version: "0.0.0" });
  registerOverviewTool(server, db, root);
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("cw_overview non-code focus", () => {
  it("shows summary evidence for focused non-code matches instead of only symbol-name misses", async () => {
    const result = await getTool(server, "cw_overview").handler({
      path: ".",
      depth: 3,
      max_tokens: 1200,
      query: "district approval auto-enrollment policy",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("docs/partner-policy.md");
    expect(text).toContain("summary match:");
    expect(text).toContain("district approval");
    expect(text).not.toContain("no direct symbol name match");
  });

  it("shows Key Entry Points section with top exported symbols by centrality", async () => {
    const result = await getTool(server, "cw_overview").handler({
      path: ".",
      depth: 2,
      max_tokens: 2000,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("Key Entry Points:");
    expect(text).toContain("evaluatePartnerEligibility");
    expect(text).toMatch(/function evaluatePartnerEligibility \(src\/eligibility\.ts:\d+\)/);
  });

  it("shows 'No files matched' message when query has no matches, without padding with unrelated files", async () => {
    const result = await getTool(server, "cw_overview").handler({
      path: ".",
      depth: 2,
      max_tokens: 2000,
      query: "xyznonexistentquerytermthatwontmatch",
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("No files matched this query.");
    expect(text).not.toContain("No exact symbol match found");
    expect(text).toContain("cw_capsule");
  });
});
