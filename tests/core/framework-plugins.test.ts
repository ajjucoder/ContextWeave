import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/db/migrations.js";
import { indexProject } from "../../src/core/indexer.js";
import { edgeQueries } from "../../src/db/queries/edges.js";
import { symbolQueries } from "../../src/db/queries/symbols.js";
import type { EdgeKind, SymbolKind, SymbolRecord } from "../../src/core/types.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

interface FixtureFile {
  path: string;
  content: string;
}

interface PluginCase {
  plugin: string;
  files: FixtureFile[];
  source: { name: string; kind?: SymbolKind };
  target: { name: string; kind?: SymbolKind };
  edgeKinds: EdgeKind[];
}

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "cw-framework-plugin-"));
  tempRoots.push(root);
  return root;
}

function writeFixture(root: string, files: FixtureFile[]): void {
  for (const file of files) {
    const fullPath = join(root, file.path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, file.content);
  }
}

function findSymbol(
  allSymbols: SymbolRecord[],
  expected: { name: string; kind?: SymbolKind }
): SymbolRecord | undefined {
  return allSymbols.find((symbol) => symbol.name === expected.name && (!expected.kind || symbol.kind === expected.kind));
}

function expectSyntheticEdge(
  db: Database.Database,
  source: { name: string; kind?: SymbolKind },
  target: { name: string; kind?: SymbolKind },
  edgeKinds: EdgeKind[]
): void {
  const symbols = symbolQueries(db);
  const edges = edgeQueries(db);
  const allSymbols = symbols.getAll();

  const sourceSymbol = findSymbol(allSymbols, source);
  const targetSymbol = findSymbol(allSymbols, target);

  expect(sourceSymbol, `missing source symbol ${source.name}`).toBeDefined();
  expect(targetSymbol, `missing target symbol ${target.name}`).toBeDefined();

  const outgoing = edges.getBySource(sourceSymbol!.id);
  expect(
    outgoing.some(
      (edge) => edge.targetSymbolId === targetSymbol!.id && edgeKinds.includes(edge.kind)
    ),
    `expected ${source.name} -> ${target.name} with one of ${edgeKinds.join(", ")}`
  ).toBe(true);
}

const pluginCases: PluginCase[] = [
  {
    plugin: "django",
    files: [
      {
        path: "app/views.py",
        content: `def user_detail(request):
    return {"ok": True}
`,
      },
      {
        path: "app/urls.py",
        content: `from .views import user_detail

def build_urls():
    urlpatterns = [
        path("users/", user_detail),
    ]
    return urlpatterns
`,
      },
    ],
    source: { name: "build_urls", kind: "function" },
    target: { name: "user_detail", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "spring",
    files: [
      {
        path: "src/main/java/com/example/UserController.java",
        content: `public class UserController {
    @GetMapping("/users")
    public String listUsers() {
        return "ok";
    }
}
`,
      },
    ],
    source: { name: "UserController", kind: "class" },
    target: { name: "listUsers", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "axum",
    files: [
      {
        path: "src/routes.rs",
        content: `async fn list_users() -> &'static str {
    "ok"
}

fn build_router() {
    let _app = Router::new().route("/users", get(list_users));
}
`,
      },
    ],
    source: { name: "build_router", kind: "function" },
    target: { name: "list_users", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "rails",
    files: [
      {
        path: "app/routes.rb",
        content: `def draw_routes
  get "users", to: "users#index"
end

class UsersController
  def index
    "ok"
  end
end
`,
      },
    ],
    source: { name: "draw_routes", kind: "function" },
    target: { name: "index", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "flask",
    files: [
      {
        path: "app/views.py",
        content: `class HealthController:
    @app.route("/health", methods=["GET"])
    def health(self):
        return "ok"
`,
      },
    ],
    source: { name: "HealthController", kind: "class" },
    target: { name: "health", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "fastapi",
    files: [
      {
        path: "app/routes.py",
        content: `class UserRoutes:
    @router.get("/users")
    def list_users(self):
        return {"ok": True}
`,
      },
    ],
    source: { name: "UserRoutes", kind: "class" },
    target: { name: "list_users", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "gin",
    files: [
      {
        path: "server/routes.go",
        content: `func getUser() string {
    return "ok"
}

func registerRoutes(r *gin.Engine) {
    r.GET("/users", getUser)
}
`,
      },
    ],
    source: { name: "registerRoutes", kind: "function" },
    target: { name: "getUser", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "convex",
    files: [
      {
        path: "convex/orders.ts",
        content: `export const createOrder = mutation({
  handler: async () => {
    return { ok: true };
  },
});
`,
      },
      {
        path: "src/order-form.tsx",
        content: `export function submitOrder() {
  const createOrder = useMutation(api.orders.createOrder);
  return createOrder({});
}
`,
      },
    ],
    source: { name: "submitOrder", kind: "function" },
    target: { name: "createOrder" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "aspnet",
    files: [
      {
        path: "Controllers/UsersController.cs",
        content: `public class UsersController : ControllerBase
{
    [HttpGet("/users")]
    public string GetUsers()
    {
        return "ok";
    }
}
`,
      },
    ],
    source: { name: "UsersController", kind: "class" },
    target: { name: "GetUsers", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "celery-sidekiq",
    files: [
      {
        path: "tasks.py",
        content: `@shared_task
def send_email():
    return "ok"

def queue_email():
    return send_email.delay()
`,
      },
    ],
    source: { name: "queue_email", kind: "function" },
    target: { name: "send_email", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "laravel",
    files: [
      {
        path: "routes/web.php",
        content: `<?php
function registerRoutes() {
    Route::get("/users", "UserController@index");
}

class UserController {
    public function index() {
        return "ok";
    }
}
`,
      },
    ],
    source: { name: "registerRoutes", kind: "function" },
    target: { name: "index", kind: "method" },
    edgeKinds: ["framework_entry"],
  },
  {
    plugin: "express",
    files: [
      {
        path: "src/controllers/oauth-controller.js",
        content: `const oauthController = {
  handleOAuthCallback: async (req, res) => {
    return res.json({ ok: true });
  },
};

module.exports = { oauthController };
`,
      },
      {
        path: "src/routes/oauth.js",
        content: `const { oauthController } = require("../controllers/oauth-controller");

function registerOAuthRoutes(app) {
  app.post("/oauth/callback", oauthController.handleOAuthCallback);
}

module.exports = { registerOAuthRoutes };
`,
      },
    ],
    source: { name: "registerOAuthRoutes", kind: "function" },
    target: { name: "handleOAuthCallback", kind: "arrow" },
    edgeKinds: ["route-handler"],
  },
  {
    plugin: "next",
    files: [
      {
        path: "src/lib/client/inquiry-api.ts",
        content: `export async function submitInquiry() {
  const response = await fetch("/api/inquiries", {
    method: "POST",
  });
  return response.json();
}
`,
      },
      {
        path: "src/app/api/inquiries/route.ts",
        content: `export async function POST() {
  return Response.json({ ok: true });
}
`,
      },
    ],
    source: { name: "submitInquiry", kind: "function" },
    target: { name: "POST", kind: "function" },
    edgeKinds: ["framework_entry"],
  },
];

describe("framework plugins", () => {
  it.each(pluginCases)("creates a synthetic edge for $plugin", async ({ files, source, target, edgeKinds }) => {
    const root = makeTempProject();
    writeFixture(root, files);

    const db = new Database(":memory:");
    runMigrations(db);
    await indexProject(db, root);

    expectSyntheticEdge(db, source, target, edgeKinds);

    db.close();
  });
});
