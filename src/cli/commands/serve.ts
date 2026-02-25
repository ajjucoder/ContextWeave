import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startMcpServer } from "../../mcp/server.js";
import { loadConfig } from "../../utils/config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("cli:serve");

export async function runServe(projectRoot: string): Promise<void> {
  const cwDir = resolve(projectRoot, ".contextweave");

  if (!existsSync(cwDir)) {
    process.stderr.write("ContextWeave not initialized. Run `cw init` first.\n");
    process.exit(1);
  }

  const config = loadConfig(projectRoot);
  log.info("starting MCP server", { projectRoot, tokenBudget: config.tokenBudget, defaultMode: config.defaultMode });
  await startMcpServer(projectRoot, config);
}
