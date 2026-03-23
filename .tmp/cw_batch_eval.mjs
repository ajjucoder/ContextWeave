import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { encode } from "gpt-tokenizer";

import { createSchema } from "../src/db/schema.ts";
import { runMigrations } from "../src/db/migrations.ts";
import { registerCapsuleTool } from "../src/mcp/tools/capsule.ts";
import { registerOverviewTool } from "../src/mcp/tools/overview.ts";
import { registerReadTool } from "../src/mcp/tools/read.ts";
import { registerFlowTool } from "../src/mcp/tools/flow.ts";
import { registerImpactTool } from "../src/mcp/tools/impact.ts";
import { registerRecallTool } from "../src/mcp/tools/recall.ts";
import { registerStatsTool } from "../src/mcp/tools/stats.ts";
import { registerStatusTool } from "../src/mcp/tools/status.ts";
import { registerSearchTool } from "../src/mcp/tools/search.ts";
import { registerFilesTool } from "../src/mcp/tools/files.ts";
import { loadConfig } from "../src/utils/config.ts";
import { createEmbeddingRuntime, disposeEmbeddingRuntime } from "../src/core/embedding-runtime.ts";
import { setLogLevel } from "../src/utils/logger.ts";

function getRegisteredTool(server, name) {
  const tools = server._registeredTools;
  const tool = tools?.[name];
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

function countTokens(value) {
  return encode(value).length;
}

function extractText(content) {
  return (content ?? [])
    .filter((part) => part?.type === "text" && typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
}

function parseStructuredOutput(content) {
  for (const part of content ?? []) {
    const text = part?.text;
    if (typeof text !== "string") continue;
    const match = text.match(/<!-- structured_output: (.+) -->/s);
    if (!match?.[1]) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
  return null;
}

function parseInput() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: node cw_batch_eval.mjs <input.json>");
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function main() {
  setLogLevel("error");
  const input = parseInput();
  const projectRoot = resolve(input.projectRoot);
  const sessionId = input.sessionId ?? "cw-batch-eval";
  const dbPath = resolve(projectRoot, ".contextweave", "contextweave.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, "cw-batch-eval", projectRoot, Date.now());

  const config = loadConfig(projectRoot);
  const embeddingRuntime = await createEmbeddingRuntime(db, {
    modelName: config.embeddingModel,
  });

  const server = new McpServer({ name: "cw-batch-eval", version: "0.0.0" });
  registerStatusTool(server, db, projectRoot);
  registerFilesTool(server, db, projectRoot);
  registerSearchTool(server, db, projectRoot);
  registerReadTool(server, db, projectRoot);
  registerOverviewTool(server, db, projectRoot, embeddingRuntime);
  registerFlowTool(server, db);
  registerImpactTool(server, db);
  registerRecallTool(server, db);
  registerCapsuleTool(server, db, projectRoot, config, sessionId, embeddingRuntime);
  registerStatsTool(server, db, projectRoot, sessionId);

  const results = [];
  for (const call of input.calls ?? []) {
    const start = Date.now();
    const handler = getRegisteredTool(server, call.tool).handler;
    const raw = await handler(call.args ?? {});
    const elapsedMs = Date.now() - start;
    const text = extractText(raw.content);
    const structured = parseStructuredOutput(raw.content);
    const inputPayload = JSON.stringify({ tool: call.tool, args: call.args ?? {} });
    results.push({
      tool: call.tool,
      args: call.args ?? {},
      elapsedMs,
      isError: raw.isError === true,
      inputTokens: countTokens(inputPayload),
      outputTokens: countTokens(text),
      totalTokens: countTokens(inputPayload) + countTokens(text),
      text,
      structured,
    });
  }

  await disposeEmbeddingRuntime(embeddingRuntime);
  db.close();
  process.stdout.write(JSON.stringify({ projectRoot, sessionId, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
