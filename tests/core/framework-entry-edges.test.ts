import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  const root = mkdtempSync(join(tmpdir(), "cw-framework-edge-"));
  tempRoots.push(root);
  return root;
}

describe("framework_entry synthetic edges", () => {
  it("adds framework_entry edges from Next.js route handlers", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "app", "api", "users"), { recursive: true });
    mkdirSync(join(root, "src", "lib"), { recursive: true });

    writeFileSync(
      join(root, "src", "lib", "user-service.ts"),
      `export function getUser() {
  return { id: 1 };
}
`
    );

    writeFileSync(
      join(root, "src", "app", "api", "users", "route.ts"),
      `import { getUser } from "../../../lib/user-service";

export async function GET() {
  return getUser();
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const getHandler = symbols.getByName("GET").find((s) => s.kind === "function");
    const getUser = symbols.getByName("getUser").find((s) => s.kind === "function");
    expect(getHandler).toBeDefined();
    expect(getUser).toBeDefined();

    const handlerEdges = edges.getBySource(getHandler!.id);
    const frameworkEdges = handlerEdges.filter((edge) => edge.kind === "framework_entry");
    const frameworkTargets = new Set(frameworkEdges.map((edge) => edge.targetSymbolId));

    expect(frameworkTargets.has(getUser!.id)).toBe(true);
    db.close();
  });

  it("adds framework_entry edges from Next.js fetch callers to matching route handlers", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "lib", "client"), { recursive: true });
    mkdirSync(join(root, "src", "app", "api", "inquiries"), { recursive: true });
    mkdirSync(join(root, "src", "lib", "server"), { recursive: true });

    writeFileSync(
      join(root, "src", "lib", "client", "inquiry-api.ts"),
      `export async function submitInquiry(formData: { email: string }) {
  const response = await fetch("/api/inquiries", {
    method: "POST",
    body: JSON.stringify(formData),
  });
  return response.json();
}
`
    );

    writeFileSync(
      join(root, "src", "lib", "server", "inquiry-service.ts"),
      `export async function createInquiry() {
  return { id: "inq_123" };
}
`
    );

    writeFileSync(
      join(root, "src", "app", "api", "inquiries", "route.ts"),
      `import { createInquiry } from "../../../../lib/server/inquiry-service";

export async function POST() {
  return createInquiry();
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const submitInquiry = symbols.getByName("submitInquiry").find((s) => s.kind === "function");
    const postHandler = symbols.getByName("POST").find((s) => s.kind === "function");
    expect(submitInquiry).toBeDefined();
    expect(postHandler).toBeDefined();

    const outgoing = edges.getBySource(submitInquiry!.id);
    const frameworkTargets = new Set(
      outgoing.filter((edge) => edge.kind === "framework_entry").map((edge) => edge.targetSymbolId)
    );

    expect(frameworkTargets.has(postHandler!.id)).toBe(true);
    db.close();
  });

  it("maps dynamic Next.js fetch paths to matching route handlers", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "lib", "client"), { recursive: true });
    mkdirSync(join(root, "src", "app", "api", "sessions", "[sessionId]"), { recursive: true });
    mkdirSync(join(root, "src", "lib", "server"), { recursive: true });

    writeFileSync(
      join(root, "src", "lib", "client", "session-api.ts"),
      `export async function loadSessionDetail(sessionId: string) {
  const response = await fetch(\`/api/sessions/\${sessionId}\`);
  return response.json();
}
`
    );

    writeFileSync(
      join(root, "src", "lib", "server", "session-service.ts"),
      `export async function getSessionDetail(sessionId: string) {
  return { id: sessionId };
}
`
    );

    writeFileSync(
      join(root, "src", "app", "api", "sessions", "[sessionId]", "route.ts"),
      `import { getSessionDetail } from "../../../../../lib/server/session-service";

export async function GET() {
  return getSessionDetail("session_123");
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const loadSessionDetail = symbols.getByName("loadSessionDetail").find((s) => s.kind === "function");
    const getHandler = symbols.getByName("GET").find((s) => s.kind === "function");
    expect(loadSessionDetail).toBeDefined();
    expect(getHandler).toBeDefined();

    const outgoing = edges.getBySource(loadSessionDetail!.id);
    const frameworkTargets = new Set(
      outgoing.filter((edge) => edge.kind === "framework_entry").map((edge) => edge.targetSymbolId)
    );

    expect(frameworkTargets.has(getHandler!.id)).toBe(true);
    db.close();
  });

  it("maps Next.js pages-router loaders to pages/api default handlers", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "pages", "users", "[userId]"), { recursive: true });
    mkdirSync(join(root, "src", "pages", "api", "users"), { recursive: true });
    mkdirSync(join(root, "src", "lib", "server"), { recursive: true });

    writeFileSync(
      join(root, "src", "pages", "users", "[userId]", "page.tsx"),
      `export async function getServerSideProps(context) {
  const response = await fetch(\`/api/users/\${context.params.userId}\`);
  const user = await response.json();
  return { props: { user } };
}
`
    );

    writeFileSync(
      join(root, "src", "lib", "server", "user-service.ts"),
      `export async function getUserDetail(userId: string) {
  return { id: userId };
}
`
    );

    writeFileSync(
      join(root, "src", "pages", "api", "users", "[userId].ts"),
      `import { getUserDetail } from "../../../lib/server/user-service";

export default async function handler(req, res) {
  const user = await getUserDetail(req.query.userId);
  return res.json(user);
}
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const getServerSideProps = symbols.getByName("getServerSideProps").find((s) => s.kind === "function");
    const handler = symbols.getByName("handler").find((s) => s.kind === "function");
    expect(getServerSideProps).toBeDefined();
    expect(handler).toBeDefined();

    const outgoing = edges.getBySource(getServerSideProps!.id);
    const frameworkTargets = new Set(
      outgoing.filter((edge) => edge.kind === "framework_entry").map((edge) => edge.targetSymbolId)
    );

    expect(frameworkTargets.has(handler!.id)).toBe(true);
    db.close();
  });

  it("adds framework_entry edges from Express route registrars to CommonJS controller handlers", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, "src", "routes"), { recursive: true });
    mkdirSync(join(root, "src", "controllers"), { recursive: true });
    mkdirSync(join(root, "src", "services"), { recursive: true });

    writeFileSync(
      join(root, "src", "services", "oauth-service.js"),
      `async function exchangeCode(code) {
  return { accessToken: code };
}

async function persistProviderToken(token) {
  return token;
}

module.exports = {
  exchangeCode,
  persistProviderToken,
};
`
    );

    writeFileSync(
      join(root, "src", "controllers", "oauth-controller.js"),
      `const {
  exchangeCode,
  persistProviderToken,
} = require("../services/oauth-service");

const oauthController = {
  handleOAuthCallback: async (req, res) => {
    const token = await exchangeCode(req.query.code);
    await persistProviderToken(token);
    return res.json({ ok: true });
  },
};

module.exports = { oauthController };
`
    );

    writeFileSync(
      join(root, "src", "routes", "oauth.js"),
      `const { oauthController } = require("../controllers/oauth-controller");

function registerOAuthRoutes(app) {
  app.post("/oauth/callback", oauthController.handleOAuthCallback);
}

module.exports = { registerOAuthRoutes };
`
    );

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    const symbols = symbolQueries(db);
    const edges = edgeQueries(db);

    const registerOAuthRoutes = symbols.getByName("registerOAuthRoutes").find((s) => s.kind === "function");
    const handleOAuthCallback = symbols.getByName("handleOAuthCallback").find((s) => s.kind === "arrow");
    const persistProviderToken = symbols.getByName("persistProviderToken").find((s) => s.kind === "function");
    expect(registerOAuthRoutes).toBeDefined();
    expect(handleOAuthCallback).toBeDefined();
    expect(persistProviderToken).toBeDefined();

    const registrarOutgoing = edges.getBySource(registerOAuthRoutes!.id);
    const registrarTargets = new Set(
      registrarOutgoing.filter((edge) => edge.kind === "framework_entry").map((edge) => edge.targetSymbolId)
    );
    expect(registrarTargets.has(handleOAuthCallback!.id)).toBe(true);

    const controllerOutgoing = edges.getBySource(handleOAuthCallback!.id);
    const controllerTargets = new Set(controllerOutgoing.map((edge) => edge.targetSymbolId));
    expect(controllerTargets.has(persistProviderToken!.id)).toBe(true);
    db.close();
  });
});
