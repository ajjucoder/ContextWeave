const hookConfig = {
  hooks: {
    PostToolUse: [
      {
        matcher: "Write|Edit|MultiEdit|Read",
        command: "node -e \"const payload = { tool_name: process.env.TOOL_NAME ?? '', tool_input: JSON.parse(process.env.TOOL_INPUT ?? '{}') }; process.stdout.write(JSON.stringify(payload));\" | node dist/hooks/post-tool-use.js",
      },
    ],
    SessionEnd: [
      {
        matcher: ".*",
        command: "node -e \"process.stdout.write(JSON.stringify({ session_id: process.env.SESSION_ID ?? '' }));\" | node dist/hooks/session-end.js",
      },
    ],
  },
};

process.stdout.write("Add the following to your .claude/settings.json:\n\n");
process.stdout.write(JSON.stringify(hookConfig, null, 2) + "\n");
