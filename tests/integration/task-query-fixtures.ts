export const NARROW_QUERIES = [
  "generateCapsule",
  "weightedBfsTraversal",
  "scorePivotRelevance",
  "SessionContext",
  "computeClusters",
] as const;

export const BROAD_QUERIES = [
  "capsule generation pipeline scoring compression",
  "database schema migration tables indexes",
  "file indexing parsing symbol extraction",
  "memory observation staleness confidence decay",
  "MCP server tool registration transport",
] as const;

export const TASK_QUERIES = [
  "find bugs in the capsule pipeline",
  "how does the indexer handle file changes",
  "implement a new MCP tool for symbol search",
  "optimize the BFS traversal for large graphs",
  "check for error handling issues in database queries",
] as const;

export const NARROW_THRESHOLD = 0.7;
export const BROAD_THRESHOLD = 0.55;
export const TASK_THRESHOLD = 0.5;
export const OVERALL_THRESHOLD = 0.6;

export const NARROW_TOKEN_BUDGET = 4000;
export const BROAD_TOKEN_BUDGET = 10000;
export const TASK_TOKEN_BUDGET = 10000;
