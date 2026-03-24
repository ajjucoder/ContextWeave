import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { ObservationStore } from "../../src/memory/observations.js";
import { registerRecallTool } from "../../src/mcp/tools/recall.js";

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

describe("cw_recall output grouping", () => {
  it("hides passive observations by default", async () => {
    const store = new ObservationStore(db);
    store.create({
      sessionId: "session-1",
      scope: "passive",
      note: "Passive auth query telemetry",
      confidence: 0.8,
    });
    store.create({
      sessionId: "session-1",
      scope: "architecture",
      note: "Auth middleware validates JWT in route handlers",
      confidence: 1.0,
    });

    let handler:
      | ((args: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => Promise<{ content: Array<{ text: string }> }>)
      | undefined;

    const fakeServer = {
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        fn: (args: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => Promise<{ content: Array<{ text: string }> }>
      ) => {
        handler = fn;
      },
    };

    registerRecallTool(fakeServer as any, db);
    expect(handler).toBeDefined();

    const result = await handler!({ query: "auth", limit: 10 });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Intentional observations:");
    expect(text).not.toContain("Passive observations:");
    expect(text).toContain("Auth middleware validates JWT in route handlers");
  });

  it("can return passive observations when explicitly requested", async () => {
    const store = new ObservationStore(db);
    store.create({
      sessionId: "session-1",
      scope: "passive",
      note: "Passive auth query telemetry",
      confidence: 0.8,
    });

    let handler:
      | ((args: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => Promise<{ content: Array<{ text: string }> }>)
      | undefined;

    const fakeServer = {
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        fn: (args: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => Promise<{ content: Array<{ text: string }> }>
      ) => {
        handler = fn;
      },
    };

    registerRecallTool(fakeServer as any, db);
    expect(handler).toBeDefined();

    const result = await handler!({ query: "auth", scope: "passive", limit: 10 });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Passive observations:");
    expect(text).toContain("Passive auth query telemetry");
  });

  it("surfaces passive observations when include_stale is enabled", async () => {
    const store = new ObservationStore(db);
    store.create({
      sessionId: "session-1",
      scope: "passive",
      note: "Passive auth query telemetry",
      confidence: 0.8,
    });
    store.create({
      sessionId: "session-1",
      scope: "architecture",
      note: "Auth middleware validates JWT in route handlers",
      confidence: 1.0,
    });

    let handler:
      | ((args: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => Promise<{ content: Array<{ text: string }> }>)
      | undefined;

    const fakeServer = {
      tool: (
        _name: string,
        _description: string,
        _schema: unknown,
        fn: (args: { query: string; scope?: string; include_stale?: boolean; limit?: number }) => Promise<{ content: Array<{ text: string }> }>
      ) => {
        handler = fn;
      },
    };

    registerRecallTool(fakeServer as any, db);
    expect(handler).toBeDefined();

    const result = await handler!({ query: "auth", include_stale: true, limit: 10 });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("Intentional observations:");
    expect(text).toContain("Passive observations:");
    expect(text).toContain("Passive auth query telemetry");
    expect(text).toContain("Auth middleware validates JWT in route handlers");
  });
});
