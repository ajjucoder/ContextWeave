import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { registerFlowTool } from "../../src/mcp/tools/flow.js";
import { registerImpactTool } from "../../src/mcp/tools/impact.js";

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

let root: string;
let db: Database.Database;
let server: McpServer;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cw-mcp-qualified-"));
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(
    join(root, "src", "Button.tsx"),
    `export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Save</button>;
}
`
  );
  writeFileSync(
    join(root, "src", "ComposeModal.tsx"),
    `import { Button } from "./Button";

export class ComposeModal extends React.Component {
  handleSave() {
    return persistDraft();
  }

  render() {
    return <Button onClick={this.handleSave} />;
  }
}

export class CancelModal extends React.Component {
  handleSave() {
    return persistDiscard();
  }

  render() {
    return <Button onClick={this.handleSave} />;
  }
}

export function persistDraft() {
  return true;
}

export function persistDiscard() {
  return false;
}
`
  );

  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  await indexProject(db, root);
  updateCentralityScores(db);

  server = new McpServer({ name: "contextweave-qualified-test", version: "0.0.0" });
  registerFlowTool(server, db);
  registerImpactTool(server, db);
}, 60000);

afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("mcp qualified flow and impact", () => {
  it("cw_flow follows class-qualified callback paths through registered handlers", async () => {
    const result = await getTool(server, "cw_flow").handler({
      source: "ComposeModal.render",
      target: "persistDraft",
      max_hops: 5,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ComposeModal.render");
    expect(text).toContain("ComposeModal.handleSave");
    expect(text).not.toContain("CancelModal.handleSave");
  });

  it("cw_impact scopes qualified methods to the correct owning class", async () => {
    const result = await getTool(server, "cw_impact").handler({
      target: "ComposeModal.handleSave",
      depth: 4,
    });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(text).toContain("ComposeModal.render");
    expect(text).not.toContain("CancelModal.render");
  });
});
