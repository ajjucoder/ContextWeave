import { resolve } from "node:path";
import { setLogLevel } from "./utils/logger.js";

const args = process.argv.slice(2);
const command = args[0];

if (args.includes("--debug")) {
  setLogLevel("debug");
}

const projectRoot = resolve(process.cwd());

async function main(): Promise<void> {
  switch (command) {
    case "init": {
      const { runInit } = await import("./cli/commands/init.js");
      await runInit(projectRoot);
      break;
    }
    case "serve": {
      const { runServe } = await import("./cli/commands/serve.js");
      await runServe(projectRoot);
      break;
    }
    case "status": {
      const { runStatus } = await import("./cli/commands/status.js");
      const verbose = args.includes("--verbose") || args.includes("-v");
      runStatus(projectRoot, verbose);
      break;
    }
    case "reindex": {
      const { runReindex } = await import("./cli/commands/reindex.js");
      const targetPath = args[1];
      await runReindex(projectRoot, targetPath);
      break;
    }
    case "version": {
      process.stdout.write("contextweave v0.1.0\n");
      break;
    }
    case "help":
    case undefined: {
      process.stdout.write(
        [
          "contextweave - AST-aware context capsules for Claude Code",
          "",
          "Usage: cw <command> [options]",
          "",
          "Commands:",
          "  init       Initialize ContextWeave in current project",
          "  serve      Start MCP server (used by Claude Code)",
          "  status     Show index health",
          "  reindex    Force reindex (optional: path)",
          "  version    Show version",
          "  help       Show this help",
          "",
          "Options:",
          "  --debug    Enable debug logging",
          "  --verbose  Verbose output (status command)",
          "",
        ].join("\n")
      );
      break;
    }
    default: {
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stderr.write("Run `cw help` for usage.\n");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
