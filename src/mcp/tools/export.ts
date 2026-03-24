import { isAbsolute, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod/v3";
import { edgeQueries } from "../../db/queries/edges.js";
import { fileQueries } from "../../db/queries/files.js";
import { symbolQueries } from "../../db/queries/symbols.js";
import { getRegisterTool } from "./register-helper.js";
import { toProjectRelativePath, withinPath } from "./path-filters.js";

/**
 * Exports the indexed symbol graph in interchange-friendly formats.
 */
export type ExportFormat = "dot" | "graphml" | "json";

interface ExportNode {
  id: number;
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  centrality: number;
  isExported: boolean;
}

interface ExportEdge {
  sourceId: number;
  targetId: number;
  kind: string;
}

interface GraphExport {
  format: ExportFormat;
  scope: string | null;
  nodeCount: number;
  edgeCount: number;
  nodes: ExportNode[];
  edges: ExportEdge[];
}

function normalizeScope(scope: string | undefined, projectRoot: string): string | null {
  const trimmed = scope?.trim();
  if (!trimmed || trimmed === ".") {
    return null;
  }

  const root = resolve(projectRoot);
  const absoluteScope = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
  const rel = relative(root, absoluteScope).replace(/\\/g, "/");
  if (rel.startsWith("..")) {
    throw new Error(`scope "${scope}" is outside the project root`);
  }

  return toProjectRelativePath(root, absoluteScope);
}

export function collectScopedGraph(
  db: Database.Database,
  projectRoot: string,
  scope?: string
): GraphExport {
  const normalizedScope = normalizeScope(scope, projectRoot);
  const filesApi = fileQueries(db);
  const symbolsApi = symbolQueries(db);
  const nodes: ExportNode[] = [];

  for (const file of filesApi.iterateAll()) {
    const filePath = toProjectRelativePath(projectRoot, file.path);
    if (!withinPath(filePath, normalizedScope ?? undefined)) {
      continue;
    }

    const fileSymbols = symbolsApi.getByFileId(file.id)
      .sort((a, b) =>
        a.startLine - b.startLine
        || a.endLine - b.endLine
        || a.name.localeCompare(b.name)
      );

    for (const symbol of fileSymbols) {
      nodes.push({
        id: symbol.id,
        name: symbol.name,
        kind: symbol.kind,
        filePath,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        centrality: symbol.centrality,
        isExported: symbol.isExported,
      });
    }
  }

  nodes.sort((a, b) =>
    a.filePath.localeCompare(b.filePath)
    || a.startLine - b.startLine
    || a.endLine - b.endLine
    || a.name.localeCompare(b.name)
  );

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = edgeQueries(db).getAll()
    .filter((edge) => nodeIds.has(edge.sourceSymbolId) && nodeIds.has(edge.targetSymbolId))
    .map((edge) => ({
      sourceId: edge.sourceSymbolId,
      targetId: edge.targetSymbolId,
      kind: edge.kind,
    }))
    .sort((a, b) =>
      a.sourceId - b.sourceId
      || a.targetId - b.targetId
      || a.kind.localeCompare(b.kind)
    );

  return {
    format: "json",
    scope: normalizedScope,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
  };
}

function escapeDot(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\r?\n/g, "\\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function formatDot(graph: GraphExport): string {
  const lines = [
    "digraph ContextWeaveExport {",
    "  rankdir=LR;",
    "  node [shape=box, style=rounded];",
  ];

  for (const node of graph.nodes) {
    const label = `${node.name}\\n${node.kind}\\n${node.filePath}:${node.startLine}-${node.endLine}`;
    lines.push(`  s${node.id} [label="${escapeDot(label)}"];`);
  }

  for (const edge of graph.edges) {
    lines.push(`  s${edge.sourceId} -> s${edge.targetId} [label="${escapeDot(edge.kind)}"];`);
  }

  lines.push("}");
  return lines.join("\n");
}

export function formatGraphMl(graph: GraphExport): string {
  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<graphml xmlns=\"http://graphml.graphdrawing.org/xmlns\">",
    "  <key id=\"label\" for=\"node\" attr.name=\"label\" attr.type=\"string\"/>",
    "  <key id=\"kind\" for=\"node\" attr.name=\"kind\" attr.type=\"string\"/>",
    "  <key id=\"filePath\" for=\"node\" attr.name=\"filePath\" attr.type=\"string\"/>",
    "  <key id=\"startLine\" for=\"node\" attr.name=\"startLine\" attr.type=\"int\"/>",
    "  <key id=\"endLine\" for=\"node\" attr.name=\"endLine\" attr.type=\"int\"/>",
    "  <key id=\"centrality\" for=\"node\" attr.name=\"centrality\" attr.type=\"double\"/>",
    "  <key id=\"isExported\" for=\"node\" attr.name=\"isExported\" attr.type=\"boolean\"/>",
    "  <key id=\"edgeKind\" for=\"edge\" attr.name=\"kind\" attr.type=\"string\"/>",
    "  <graph id=\"ContextWeaveExport\" edgedefault=\"directed\">",
  ];

  for (const node of graph.nodes) {
    lines.push(`    <node id="s${node.id}">`);
    lines.push(`      <data key="label">${escapeXml(node.name)}</data>`);
    lines.push(`      <data key="kind">${escapeXml(node.kind)}</data>`);
    lines.push(`      <data key="filePath">${escapeXml(node.filePath)}</data>`);
    lines.push(`      <data key="startLine">${node.startLine}</data>`);
    lines.push(`      <data key="endLine">${node.endLine}</data>`);
    lines.push(`      <data key="centrality">${node.centrality}</data>`);
    lines.push(`      <data key="isExported">${String(node.isExported)}</data>`);
    lines.push("    </node>");
  }

  for (const edge of graph.edges) {
    lines.push(`    <edge id="e${edge.sourceId}_${edge.targetId}_${escapeXml(edge.kind)}" source="s${edge.sourceId}" target="s${edge.targetId}">`);
    lines.push(`      <data key="edgeKind">${escapeXml(edge.kind)}</data>`);
    lines.push("    </edge>");
  }

  lines.push("  </graph>");
  lines.push("</graphml>");
  return lines.join("\n");
}

export function formatJson(graph: GraphExport): string {
  return JSON.stringify(graph, null, 2);
}

export function registerExportTool(server: McpServer, db: Database.Database, projectRoot: string): void {
  const registerTool = getRegisterTool(server);

  registerTool(
    "cw_export",
    "Export the indexed symbol graph in dot, graphml, or json format, with optional path scoping.",
    {
      format: z.enum(["dot", "graphml", "json"]).describe("Export format"),
      scope: z.string().optional().describe("Optional file or directory scope inside the project root"),
    },
    async ({ format, scope }: { format: ExportFormat; scope?: string }) => {
      try {
        const graph = collectScopedGraph(db, projectRoot, scope);
        const payload = format === "dot"
          ? formatDot(graph)
          : format === "graphml"
            ? formatGraphMl(graph)
            : formatJson({ ...graph, format: "json" });

        return {
          content: [{ type: "text" as const, text: payload }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Export failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
