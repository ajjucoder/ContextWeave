import { expect } from "vitest";
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { updateCentralityScores } from "../../src/core/graph.js";
import { generateCapsule } from "../../src/capsule/generator.js";
import { registerOverviewTool } from "../../src/mcp/tools/overview.js";
import { registerReadTool } from "../../src/mcp/tools/read.js";
import { registerFlowTool } from "../../src/mcp/tools/flow.js";
import { registerImpactTool } from "../../src/mcp/tools/impact.js";
import { registerRecallTool } from "../../src/mcp/tools/recall.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(__dirname, "fixtures");

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

type RegisteredTool = {
  handler: (args: unknown) => Promise<ToolResult>;
};

export interface SeedContext {
  db: Database.Database;
  fixtureRoot: string;
  sessionId: string;
}

export interface FieldProject {
  db: Database.Database;
  fixtureRoot: string;
  sessionId: string;
  capsule: (
    query: string,
    tokenBudget?: number,
  ) => ReturnType<typeof generateCapsule>;
  runTool: (name: string, args: unknown) => Promise<string>;
  close: () => void;
}

function getTool(server: McpServer, name: string): RegisteredTool {
  const tools = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

export async function openFieldProject(
  fixtureName: string,
  seed?: (context: SeedContext) => void | Promise<void>
): Promise<FieldProject> {
  const fixtureRoot = resolve(FIXTURE_ROOT, fixtureName);
  const sessionId = `field-${fixtureName}`;
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, "field-test", fixtureRoot, Date.now());

  await indexProject(db, fixtureRoot);
  updateCentralityScores(db);

  if (seed) {
    await seed({ db, fixtureRoot, sessionId });
  }

  const server = new McpServer({ name: `contextweave-field-${fixtureName}`, version: "0.0.0" });
  registerOverviewTool(server, db, fixtureRoot);
  registerReadTool(server, db, fixtureRoot, sessionId);
  registerFlowTool(server, db);
  registerImpactTool(server, db);
  registerRecallTool(server, db);

  return {
    db,
    fixtureRoot,
    sessionId,
    capsule(query: string, tokenBudget = 1200) {
      return generateCapsule(db, {
        query,
        tokenBudget,
        sessionId,
        projectRoot: fixtureRoot,
      });
    },
    async runTool(name: string, args: unknown) {
      const result = await getTool(server, name).handler(args);
      return result.content[0]?.text ?? "";
    },
    close() {
      db.close();
    },
  };
}

export function expectTextIncludes(text: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(text).toContain(fragment);
  }
}

export function expectTextExcludes(text: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(text).not.toContain(fragment);
  }
}
