import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, closeDb } from "../../db/connection.js";
import { runMigrations } from "../../db/migrations.js";
import { indexProject } from "../../core/indexer.js";
import { runPageRankInBackground } from "../../core/graph.js";
const DEFAULT_CONFIG = {
  version: 1,
  ignore: ["node_modules", "dist", "build", ".git", ".next", "coverage"],
  exclude: [],
  excludePatterns: [],
  tokenBudget: 4000,
  defaultMode: "feature",
  stalenessDepth: 2,
  confidenceDecay: 0.1,
  gcThreshold: 0.1,
};

const DEFAULT_CWIGNORE = [
  "# ContextWeave ignore patterns (gitignore syntax)",
  "# Files matching these patterns will not be indexed",
  "",
  "node_modules/",
  "dist/",
  "build/",
  ".git/",
  ".next/",
  "coverage/",
  "__pycache__/",
  ".turbo/",
  ".cache/",
  "venv/",
  ".venv/",
  "target/",
  ".tox/",
  "vendor/",
  ".bundle/",
  "",
  "# Lock files",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "",
  "# Generated files",
  "*.min.js",
  "*.min.css",
  "*.map",
  "",
].join("\n");

function writeCwignoreTemplate(projectRoot: string): void {
  const cwignorePath = resolve(projectRoot, ".cwignore");
  if (existsSync(cwignorePath)) return;
  writeFileSync(cwignorePath, DEFAULT_CWIGNORE);
}

function generateClaudeMd(projectRoot: string): void {
  const claudeDir = resolve(projectRoot, ".claude");
  const claudeMdPath = resolve(claudeDir, "CLAUDE.md");

  if (existsSync(claudeMdPath)) return;
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  const content = `# ContextWeave MCP Tools

This project uses ContextWeave for AST-aware context retrieval and cross-session memory.

## Available Tools

### cw_capsule
Generate a token-budgeted context capsule for a query.
\`\`\`
cw_capsule({ query: "UserService", token_budget: 4000, mode: "feature" })
\`\`\`

### cw_impact
Analyze dependency impact of changing a symbol.
\`\`\`
cw_impact({ target: "validateEmail" })
\`\`\`

### cw_flow
Trace incoming/outgoing call flow around a symbol.
\`\`\`
cw_flow({ source: "handleRequest" })
\`\`\`

### cw_remember
Store a cross-session observation.
\`\`\`
cw_remember({ scope: "architecture", note: "Auth uses JWT refresh tokens" })
\`\`\`

### cw_recall
Search remembered observations.
\`\`\`
cw_recall({ query: "auth" })
\`\`\`

### cw_status
Show indexing and memory status.
\`\`\`
cw_status()
\`\`\`

### cw_reindex
Reindex a file or entire project.
\`\`\`
cw_reindex({ path: "src/core/parser.ts" })
\`\`\`
`;

  writeFileSync(claudeMdPath, content);
  process.stdout.write(`  Created ${claudeMdPath}\n`);
}

export async function autoInit(projectRoot: string): Promise<void> {
  const cwDir = resolve(projectRoot, ".contextweave");
  if (existsSync(cwDir)) return;

  mkdirSync(cwDir, { recursive: true });

  const configPath = resolve(cwDir, "config.json");
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");

  writeCwignoreTemplate(projectRoot);

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  runMigrations(db);

  const result = await indexProject(db, projectRoot, DEFAULT_CONFIG.ignore);
  runPageRankInBackground(dbPath);
  closeDb();

  process.stderr.write(
    `[contextweave] auto-initialized: ${result.filesIndexed} files, ${result.symbolsFound} symbols\n`
  );
}

export async function runInit(projectRoot: string): Promise<void> {
  const cwDir = resolve(projectRoot, ".contextweave");

  if (existsSync(cwDir)) {
    process.stdout.write("ContextWeave already initialized in this project.\n");
    process.stdout.write(`Config: ${cwDir}/config.json\n`);
    process.stdout.write(`Database: ${cwDir}/contextweave.db\n`);
    return;
  }

  process.stdout.write("Initializing ContextWeave...\n");

  mkdirSync(cwDir, { recursive: true });

  const configPath = resolve(cwDir, "config.json");
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  process.stdout.write(`  Created ${configPath}\n`);

  writeCwignoreTemplate(projectRoot);

  const dbPath = resolve(cwDir, "contextweave.db");
  const db = getDb(dbPath);
  try {
    runMigrations(db);
    process.stdout.write(`  Created database at ${dbPath}\n`);

    process.stdout.write("  Indexing project...\n");
    const startTime = Date.now();
    const result = await indexProject(db, projectRoot, DEFAULT_CONFIG.ignore);
    const elapsed = Date.now() - startTime;

    runPageRankInBackground(dbPath);

    process.stdout.write(`  Indexed ${result.filesIndexed} files, ${result.symbolsFound} symbols (${elapsed}ms)\n`);

    if (result.errors.length > 0) {
      process.stdout.write(`  ${result.errors.length} files had parse errors\n`);
    }

    generateClaudeMd(projectRoot);

    process.stdout.write("\nContextWeave initialized successfully!\n");
    process.stdout.write("\nTo use with Claude Code, add to .mcp.json:\n");
    process.stdout.write(JSON.stringify({
      mcpServers: {
        contextweave: {
          command: "node",
          args: [resolve(projectRoot, "node_modules/.bin/cw"), "serve"],
        },
      },
    }, null, 2) + "\n");
  } finally {
    closeDb(dbPath);
  }
}
