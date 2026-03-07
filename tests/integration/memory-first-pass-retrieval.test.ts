import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { fileQueries } from "../../src/db/queries/files.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import { ObservationStore } from "../../src/memory/observations.js";
import { generateCapsule } from "../../src/capsule/generator.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
  db.prepare("INSERT INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)")
    .run("session-1", "test-agent", "/tmp/project", Date.now());
});

afterEach(() => {
  db.close();
});

function seedProject(): { authFileId: number } {
  const files = fileQueries(db);
  const symbols = symbolQueries(db);
  const now = Date.now();

  const authFileId = files.insert({
    path: "src/runtime/core.ts",
    hash: "runtime-core",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
  symbols.insert({
    fileId: authFileId,
    name: "startHandshake",
    kind: "function",
    startLine: 1,
    endLine: 12,
    signature: "function startHandshake(request)",
    bodyHash: "runtime-core-startHandshake",
    fullSource: "export function startHandshake(request) { return issueTicket(request); }",
    isExported: true,
    docComment: null,
    centrality: 5,
    lastSeen: now,
  });

  const billingFileId = files.insert({
    path: "src/billing/retry.ts",
    hash: "billing-retry",
    lastIndexed: now,
    mtime: now,
    language: "typescript",
    symbolCount: 1,
    error: null,
  });
  symbols.insert({
    fileId: billingFileId,
    name: "retryInvoice",
    kind: "function",
    startLine: 1,
    endLine: 12,
    signature: "function retryInvoice(job)",
    bodyHash: "billing-retry-invoice",
    fullSource: "export function retryInvoice(job) { return processRetry(job); }",
    isExported: true,
    docComment: null,
    centrality: 4,
    lastSeen: now,
  });

  return { authFileId };
}

describe("durable memory first-pass retrieval", () => {
  it("promotes file-linked architecture memory into the first-pass capsule", () => {
    const { authFileId } = seedProject();
    const store = new ObservationStore(db);
    const conceptualQuery = "atrium ingress choreography";
    store.create({
      sessionId: "session-1",
      fileId: authFileId,
      scope: "architecture",
      note: "Atrium ingress choreography runs through the access gateway before issuing a ticket.",
      confidence: 1.0,
    });

    const result = generateCapsule(db, {
      query: conceptualQuery,
      tokenBudget: 1200,
      sessionId: "session-1",
      projectRoot: "/tmp/project",
    });

    expect(result.content).toContain("[architecture] Atrium ingress choreography runs through the access gateway before issuing a ticket.");
    expect(result.content).toContain("core.ts");
    expect(result.content).toContain("startHandshake");
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBeGreaterThan(0);
  });

  it("does not let passive memory steer capsule retrieval by default", () => {
    const { authFileId } = seedProject();
    const store = new ObservationStore(db);
    const conceptualQuery = "atrium ingress choreography";
    store.create({
      sessionId: "session-1",
      fileId: authFileId,
      scope: "passive",
      note: "[auto] Atrium ingress choreography runs through the access gateway before issuing a ticket.",
      confidence: 0.6,
    });

    const result = generateCapsule(db, {
      query: conceptualQuery,
      tokenBudget: 1200,
      sessionId: "session-1",
      projectRoot: "/tmp/project",
    });

    expect(result.content).not.toContain("core.ts");
    expect(result.content).not.toContain("startHandshake");
    expect(result.metadata.quality.retrieval.stageACandidateCount).toBe(0);
  });
});
