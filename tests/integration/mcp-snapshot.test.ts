import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { SessionContext } from "../../src/capsule/session-context.js";
import { observationQueries } from "../../src/db/queries/observations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { sessionQueries } from "../../src/db/queries/sessions.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { countTokens } from "../../src/utils/tokens.js";
import { registerSnapshotTool } from "../../src/mcp/tools/snapshot.js";

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
const FIXTURE_DIR = resolve(__dirname, "../fixtures");
const SESSION_ID = "session-snapshot";

beforeAll(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  await indexProject(db, FIXTURE_DIR);

  sessionQueries(db).ensureSession(SESSION_ID, FIXTURE_DIR);
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const sampleFile = files.getByPathSuffix("sample.ts");
  const impactFile = files.getByPathSuffix("impact-primary.ts");

  if (!sampleFile || !impactFile) {
    throw new Error("Expected fixture files to be indexed");
  }

  const [sampleSymbolA, sampleSymbolB] = symbols.getByFileId(sampleFile.id);
  const [impactSymbol] = symbols.getByFileId(impactFile.id);
  if (!sampleSymbolA || !sampleSymbolB || !impactSymbol) {
    throw new Error("Expected fixture symbols to be indexed");
  }

  const sessionContext = new SessionContext(db, SESSION_ID);
  sessionContext.record([
    { symbolId: sampleSymbolA.id, fileId: sampleFile.id },
    { symbolId: sampleSymbolB.id, fileId: sampleFile.id },
    { symbolId: impactSymbol.id, fileId: impactFile.id },
  ], "snapshot warmup");

  const now = Date.now();
  observationQueries(db).insert({
    sessionId: SESSION_ID,
    agentId: "test-agent",
    symbolId: null,
    fileId: sampleFile.id,
    scope: "architecture",
    note: "The email validation pipeline runs before user loading and sanitizes addresses.",
    confidence: 0.95,
    createdAt: now - 3000,
    updatedAt: now - 3000,
    stale: false,
    staleReason: null,
    archived: false,
  });
  observationQueries(db).insert({
    sessionId: SESSION_ID,
    agentId: "test-agent",
    symbolId: null,
    fileId: impactFile.id,
    scope: "decision",
    note: "Keep primary impact tracing pinned to the explicitly qualified file target.",
    confidence: 0.9,
    createdAt: now - 1000,
    updatedAt: now - 1000,
    stale: false,
    staleReason: null,
    archived: false,
  });

  server = new McpServer({ name: "contextweave-test-snapshot", version: "0.0.0" });
  registerSnapshotTool(server, db, FIXTURE_DIR, SESSION_ID);
}, 60000);

afterAll(() => {
  db.close();
});

describe("cw_snapshot", () => {
  it("returns a structured snapshot under the token budget", async () => {
    const result = await getTool(server, "cw_snapshot").handler({});

    const text = result.content[0]?.text ?? "";
    expect(result.isError).not.toBe(true);
    expect(countTokens(text)).toBeLessThanOrEqual(2048);

    const parsed = JSON.parse(text) as {
      sessionId: string;
      activeFiles: Array<{ path: string; accessCount: number }>;
      recentObservations: Array<{ scope: string; note: string }>;
      decisions: Array<{ note: string }>;
    };

    expect(parsed.sessionId).toBe(SESSION_ID);
    expect(parsed.activeFiles[0]).toEqual(expect.objectContaining({
      path: "sample.ts",
      accessCount: 2,
    }));
    expect(parsed.activeFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "impact-primary.ts", accessCount: 1 }),
    ]));
    expect(parsed.recentObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "architecture" }),
      expect.objectContaining({ scope: "decision" }),
    ]));
    expect(parsed.decisions).toEqual([
      expect.objectContaining({
        note: "Keep primary impact tracing pinned to the explicitly qualified file target.",
      }),
    ]);
  });
});
