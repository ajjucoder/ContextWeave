import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-synth-"));
  tempRoots.push(root);
  return root;
}

describe("cross-boundary edge synthesis", () => {
  it("creates event edges for EventEmitter emit/on pairs", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src"), { recursive: true });

    writeFileSync(
      join(root, "src", "emitter.ts"),
      `import { EventEmitter } from 'events';
const bus = new EventEmitter();

export function publishOrder(order: any) {
  bus.emit("order_created", order);
}

export function onOrderCreated(handler: Function) {
  bus.on("order_created", handler);
}
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);
      const allEdges = [...edgeQueries(db).iterateAll()];
      const eventEdges = allEdges.filter((e) => e.kind === "event");
      expect(eventEdges.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("creates server-action edges for Next.js fetch-to-route patterns", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "app", "api", "users"), { recursive: true });
    mkdirSync(join(root, "lib"), { recursive: true });

    writeFileSync(
      join(root, "app", "api", "users", "route.ts"),
      `export async function GET(request: Request) {
  return Response.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ created: true });
}
`
    );

    writeFileSync(
      join(root, "lib", "api-client.ts"),
      `export async function fetchUsers() {
  const res = await fetch("/api/users");
  return res.json();
}

export async function createUser(data: any) {
  const res = await fetch("/api/users", { method: "POST", body: JSON.stringify(data) });
  return res.json();
}
`
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    createSchema(db);
    runMigrations(db);

    try {
      await indexProject(db, root);
      const allEdges = [...edgeQueries(db).iterateAll()];
      const crossBoundaryEdges = allEdges.filter(
        (e) => e.kind === "event" || e.kind === "server-action"
      );
      expect(crossBoundaryEdges.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
