const hookConfig = {
  hooks: {
    PostToolUse: [
      {
        matcher: "Write|Edit|MultiEdit|Read",
        command: "echo '{\"tool_name\": \"$TOOL_NAME\", \"tool_input\": $TOOL_INPUT}' | node dist/hooks/post-tool-use.js",
      },
    ],
    SessionEnd: [
      {
        matcher: ".*",
        command: "echo '{\"session_id\": \"$SESSION_ID\"}' | node dist/hooks/session-end.js",
      },
    ],
  },
};

process.stdout.write("Add the following to your .claude/settings.json:\n\n");
process.stdout.write(JSON.stringify(hookConfig, null, 2) + "\n");
