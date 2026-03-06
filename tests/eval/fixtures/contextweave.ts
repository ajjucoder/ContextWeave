import type { EvalCodebaseFixture } from "./types.js";

export const CONTEXTWEAVE_FIXTURE: EvalCodebaseFixture = {
  id: "contextweave-src",
  label: "ContextWeave (src)",
  root: "src",
  defaultTokenBudget: 8000,
  queries: [
    {
      id: "cw-generate-capsule",
      query: "generateCapsule",
      expectedFiles: ["capsule/generator.ts"],
      expectedSymbols: ["generateCapsule"],
    },
    {
      id: "cw-weighted-bfs",
      query: "weightedBfsTraversal",
      expectedFiles: ["core/weighted-bfs.ts"],
      expectedSymbols: ["weightedBfsTraversal"],
    },
    {
      id: "cw-pivot-scorer",
      query: "scorePivotRelevance",
      expectedFiles: ["capsule/pivot-scorer.ts"],
      expectedSymbols: ["scorePivotRelevance"],
    },
    {
      id: "cw-session-context",
      query: "SessionContext",
      expectedFiles: ["capsule/session-context.ts"],
      expectedSymbols: ["SessionContext"],
    },
    {
      id: "cw-clusters",
      query: "computeClusters",
      expectedFiles: ["core/clusters.ts"],
      expectedSymbols: ["computeClusters"],
    },
    {
      id: "cw-path-alias",
      query: "path alias resolution",
      expectedFiles: ["utils/tsconfig-paths.ts", "mcp/tools/path-filters.ts"],
      expectedSymbols: ["resolveAliasedImport"],
    },
    {
      id: "cw-reexport",
      query: "re-export edge handling",
      expectedFiles: ["core/parser.ts", "core/indexer.ts"],
      expectedSymbols: ["parseFile"],
    },
    {
      id: "cw-indexer-file-changes",
      query: "how does the indexer handle file changes",
      expectedFiles: ["core/indexer.ts"],
    },
    {
      id: "cw-mcp-symbol-search",
      query: "implement a new MCP tool for symbol search",
      expectedFiles: ["mcp/tools/search.ts", "db/queries/symbols.ts"],
    },
    {
      id: "cw-db-errors",
      query: "check for error handling issues in database queries",
      expectedFiles: ["db/queries/files.ts", "db/queries/symbols.ts", "db/queries/edges.ts"],
    },
  ],
  tasks: [
    {
      id: "cw-task-indexing-pipeline",
      goal: "Recover the indexing and parsing pipeline with a broad query and a corrective follow-up.",
      attempts: [
        {
          id: "cw-task-indexing-pipeline-a1",
          query: "workspace discovery pipeline",
          expectedFiles: ["core/indexer.ts", "core/parser.ts"],
          expectedSymbols: ["indexProject", "parseFile"],
        },
        {
          id: "cw-task-indexing-pipeline-a2",
          query: "indexProject parseFile",
          expectedFiles: ["core/indexer.ts", "core/parser.ts"],
          expectedSymbols: ["indexProject", "parseFile"],
        },
      ],
    },
    {
      id: "cw-task-mcp-search",
      goal: "Find the MCP symbol-search implementation after one conceptual miss.",
      attempts: [
        {
          id: "cw-task-mcp-search-a1",
          query: "tool lookup workflow",
          expectedFiles: ["mcp/tools/search.ts", "db/queries/symbols.ts"],
          expectedSymbols: ["registerSearchTool"],
        },
        {
          id: "cw-task-mcp-search-a2",
          query: "registerSearchTool",
          expectedFiles: ["mcp/tools/search.ts"],
          expectedSymbols: ["registerSearchTool"],
        },
      ],
    },
  ],
};
