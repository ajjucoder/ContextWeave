import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(__dirname, "../..");
const TSX_CLI = resolve(PROJECT_ROOT, "node_modules/tsx/dist/cli.mjs");
const SCRIPT_PATH = resolve(PROJECT_ROOT, "scripts/generate-hook-configs.ts");

type HookConfig = {
  hooks: {
    PostToolUse: Array<{ command: string }>;
    SessionEnd: Array<{ command: string }>;
  };
};

function loadHookConfig(): HookConfig {
  const output = execFileSync(process.execPath, [TSX_CLI, SCRIPT_PATH], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  });
  const lines = output.trimEnd().split("\n");
  const json = lines.slice(2).join("\n");
  return JSON.parse(json) as HookConfig;
}

function runHookCommandProbe(command: string, env: Record<string, string>): string {
  const probe = command
    .replace("node dist/hooks/post-tool-use.js", "cat")
    .replace("node dist/hooks/session-end.js", "cat");

  return execFileSync("sh", ["-lc", probe], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  }).trim();
}

describe("generate-hook-configs", () => {
  it("emits a PostToolUse command that expands shell variables into valid JSON", () => {
    const config = loadHookConfig();

    const payload = runHookCommandProbe(config.hooks.PostToolUse[0]!.command, {
      TOOL_NAME: "Read",
      TOOL_INPUT: "{\"path\":\"src/index.ts\"}",
    });

    expect(JSON.parse(payload)).toEqual({
      tool_name: "Read",
      tool_input: { path: "src/index.ts" },
    });
  });

  it("emits a SessionEnd command that expands the session id", () => {
    const config = loadHookConfig();

    const payload = runHookCommandProbe(config.hooks.SessionEnd[0]!.command, {
      SESSION_ID: "session-123",
    });

    expect(JSON.parse(payload)).toEqual({
      session_id: "session-123",
    });
  });
});
