# ContextWeave MCP Tools

This project uses ContextWeave for AST-aware context retrieval and cross-session memory.

## Commit Conventions

- Use conventional commit format: `type(scope): description`
- Never use emojis in commit messages
- Types: feat, fix, docs, style, refactor, perf, test, chore

## Available Tools

### cw_capsule
Generate a token-budgeted context capsule for a query.
```
cw_capsule({ query: "UserService", token_budget: 4000, mode: "feature" })
```

### cw_impact
Analyze dependency impact of changing a symbol.
```
cw_impact({ target: "validateEmail" })
```

### cw_flow
Trace incoming/outgoing call flow around a symbol.
```
cw_flow({ source: "handleRequest" })
```

### cw_remember
Store a cross-session observation.
```
cw_remember({ scope: "architecture", note: "Auth uses JWT refresh tokens" })
```

### cw_recall
Search remembered observations.
```
cw_recall({ query: "auth" })
```

### cw_status
Show indexing and memory status.
```
cw_status()
```

### cw_reindex
Reindex a file or entire project.
```
cw_reindex({ path: "src/core/parser.ts" })
```
