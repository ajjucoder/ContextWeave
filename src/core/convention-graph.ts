import type Database from "better-sqlite3";
import type { ArchLayer, RetrievalLane } from "./repo-profiler.js";
import { loadProfile, classifyFileLayer } from "./repo-profiler.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("convention-graph");

export interface Convention {
  id: string;
  name: string;
  layer: ArchLayer | "unknown";
  source: "profile" | "naming" | "pattern";
  fileCount: number;
}

export interface ConventionEdge {
  sourceConvention: string;
  targetConvention: string;
  edgeCount: number;
}

export interface ConventionGraph {
  conventions: Convention[];
  edges: ConventionEdge[];
}

interface FileConventionRow {
  id: number;
  path: string;
}

const NAMING_CONVENTIONS: Array<{
  pattern: RegExp;
  convention: string;
  layer: ArchLayer | "unknown";
}> = [
  { pattern: /\.controller\./i, convention: "controllers", layer: "api-route" },
  { pattern: /\.service\./i, convention: "services", layer: "server" },
  { pattern: /\.repository\./i, convention: "repositories", layer: "storage" },
  { pattern: /\.model\./i, convention: "models", layer: "storage" },
  { pattern: /\.entity\./i, convention: "entities", layer: "storage" },
  { pattern: /\.schema\./i, convention: "schemas", layer: "storage" },
  { pattern: /\.hook\./i, convention: "hooks", layer: "client-fetch" },
  { pattern: /\.store\./i, convention: "stores", layer: "state" },
  { pattern: /\.middleware\./i, convention: "middleware", layer: "server" },
  { pattern: /\.guard\./i, convention: "guards", layer: "server" },
  { pattern: /\.interceptor\./i, convention: "interceptors", layer: "server" },
  { pattern: /\.pipe\./i, convention: "pipes", layer: "server" },
  { pattern: /\.directive\./i, convention: "directives", layer: "ui-component" },
  { pattern: /\.component\.(tsx?|jsx?)$/i, convention: "components", layer: "ui-component" },
  { pattern: /\.resolver\./i, convention: "resolvers", layer: "api-route" },
  { pattern: /\.dto\./i, convention: "dtos", layer: "server" },
  { pattern: /\.util\./i, convention: "utilities", layer: "unknown" },
  { pattern: /\.helper\./i, convention: "helpers", layer: "unknown" },
  { pattern: /\.config\./i, convention: "config", layer: "config" },
  { pattern: /\.test\.|\.spec\.|__tests__/i, convention: "tests", layer: "unknown" },
];

const DIRECTORY_CONVENTIONS: Array<{
  dirPattern: RegExp;
  convention: string;
  layer: ArchLayer | "unknown";
}> = [
  { dirPattern: /\/(controllers?|handlers?)\//i, convention: "controllers", layer: "api-route" },
  { dirPattern: /\/services?\//i, convention: "services", layer: "server" },
  { dirPattern: /\/(repositories|repos?|dao)\//i, convention: "repositories", layer: "storage" },
  { dirPattern: /\/(models?|entities)\//i, convention: "models", layer: "storage" },
  { dirPattern: /\/hooks?\//i, convention: "hooks", layer: "client-fetch" },
  { dirPattern: /\/(store|state|redux|zustand)\//i, convention: "stores", layer: "state" },
  { dirPattern: /\/middleware\//i, convention: "middleware", layer: "server" },
  { dirPattern: /\/(components?|widgets?)\//i, convention: "components", layer: "ui-component" },
  { dirPattern: /\/(pages?|views?|screens?)\//i, convention: "pages", layer: "ui-component" },
  { dirPattern: /\/(routes?|routing)\//i, convention: "routes", layer: "api-route" },
  { dirPattern: /\/(api|endpoints?)\//i, convention: "api", layer: "api-route" },
  { dirPattern: /\/(schemas?|migrations?)\//i, convention: "schemas", layer: "storage" },
  { dirPattern: /\/(utils?|lib|helpers?|shared)\//i, convention: "utilities", layer: "unknown" },
  { dirPattern: /\/(config|settings?)\//i, convention: "config", layer: "config" },
];

function classifyFileConvention(
  filePath: string,
  lanes: RetrievalLane[]
): { convention: string; layer: ArchLayer | "unknown" } | null {
  const normalized = "/" + filePath.replace(/\\/g, "/");

  for (const { pattern, convention, layer } of NAMING_CONVENTIONS) {
    if (pattern.test(filePath)) {
      return { convention, layer };
    }
  }

  for (const { dirPattern, convention, layer } of DIRECTORY_CONVENTIONS) {
    if (dirPattern.test(normalized)) {
      return { convention, layer };
    }
  }

  if (lanes.length > 0) {
    const profileLayer = classifyFileLayer(lanes, filePath);
    if (profileLayer) {
      return { convention: profileLayer, layer: profileLayer };
    }
  }

  return null;
}

function detectBarrelFiles(db: Database.Database): Set<number> {
  const barrelFileIds = new Set<number>();

  const rows = db.prepare(`
    SELECT f.id, f.path, f.symbol_count,
      (SELECT COUNT(*) FROM edges e
       JOIN symbols s ON s.id = e.source_symbol_id
       WHERE s.file_id = f.id AND e.kind = 'reexport') as reexport_count
    FROM files f
    WHERE f.path LIKE '%/index.%' OR f.path LIKE '%/index'
  `).all() as Array<{ id: number; path: string; symbol_count: number; reexport_count: number }>;

  for (const row of rows) {
    if (row.reexport_count > 0 && row.reexport_count >= row.symbol_count * 0.5) {
      barrelFileIds.add(row.id);
    }
  }

  return barrelFileIds;
}

export function buildConventionGraph(db: Database.Database, projectRoot: string): ConventionGraph {
  const profile = loadProfile(db, projectRoot);
  const lanes = profile?.lanes ?? [];

  const allFiles = db.prepare("SELECT id, path FROM files").all() as FileConventionRow[];
  const barrelFiles = detectBarrelFiles(db);

  const conventionFiles = new Map<string, number[]>();
  const conventionLayers = new Map<string, ArchLayer | "unknown">();

  for (const file of allFiles) {
    if (barrelFiles.has(file.id)) {
      const existing = conventionFiles.get("barrel-indexes") ?? [];
      existing.push(file.id);
      conventionFiles.set("barrel-indexes", existing);
      conventionLayers.set("barrel-indexes", "unknown");
      continue;
    }

    const classification = classifyFileConvention(file.path, lanes);
    if (!classification) continue;

    const existing = conventionFiles.get(classification.convention) ?? [];
    existing.push(file.id);
    conventionFiles.set(classification.convention, existing);

    if (!conventionLayers.has(classification.convention)) {
      conventionLayers.set(classification.convention, classification.layer);
    }
  }

  const conventions: Convention[] = [];
  for (const [name, fileIds] of conventionFiles) {
    if (fileIds.length < 2) continue;
    conventions.push({
      id: name,
      name,
      layer: conventionLayers.get(name) ?? "unknown",
      source: lanes.length > 0 ? "profile" : "naming",
      fileCount: fileIds.length,
    });
  }

  const edges: ConventionEdge[] = [];
  const conventionNames = conventions.map((c) => c.id);

  for (let i = 0; i < conventionNames.length; i++) {
    for (let j = i + 1; j < conventionNames.length; j++) {
      const sourceFiles = conventionFiles.get(conventionNames[i]!) ?? [];
      const targetFiles = conventionFiles.get(conventionNames[j]!) ?? [];

      if (sourceFiles.length === 0 || targetFiles.length === 0) continue;

      const sourceSet = new Set(sourceFiles);
      const targetSet = new Set(targetFiles);

      const edgeCount = (db.prepare(`
        SELECT COUNT(*) as cnt
        FROM edges e
        JOIN symbols sf ON sf.id = e.source_symbol_id
        JOIN symbols tf ON tf.id = e.target_symbol_id
        WHERE sf.file_id IN (SELECT value FROM json_each(?))
          AND tf.file_id IN (SELECT value FROM json_each(?))
      `).get(
        JSON.stringify([...sourceSet]),
        JSON.stringify([...targetSet])
      ) as { cnt: number }).cnt;

      if (edgeCount > 0) {
        edges.push({
          sourceConvention: conventionNames[i]!,
          targetConvention: conventionNames[j]!,
          edgeCount,
        });
      }
    }
  }

  log.info("convention graph built", {
    conventions: conventions.length,
    edges: edges.length,
    totalFiles: allFiles.length,
    classifiedFiles: [...conventionFiles.values()].reduce((sum, f) => sum + f.length, 0),
  });

  return { conventions, edges };
}

export function persistConventions(db: Database.Database, graph: ConventionGraph): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conventions (
      id     TEXT PRIMARY KEY,
      name   TEXT NOT NULL,
      layer  TEXT NOT NULL,
      source TEXT NOT NULL,
      file_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS convention_edges (
      source_convention TEXT NOT NULL,
      target_convention TEXT NOT NULL,
      edge_count INTEGER NOT NULL,
      PRIMARY KEY (source_convention, target_convention)
    );
  `);

  const insertConvention = db.prepare(
    "INSERT OR REPLACE INTO conventions (id, name, layer, source, file_count) VALUES (?, ?, ?, ?, ?)"
  );
  const insertEdge = db.prepare(
    "INSERT OR REPLACE INTO convention_edges (source_convention, target_convention, edge_count) VALUES (?, ?, ?)"
  );

  const runAll = db.transaction(() => {
    db.prepare("DELETE FROM conventions").run();
    db.prepare("DELETE FROM convention_edges").run();

    for (const conv of graph.conventions) {
      insertConvention.run(conv.id, conv.name, conv.layer, conv.source, conv.fileCount);
    }
    for (const edge of graph.edges) {
      insertEdge.run(edge.sourceConvention, edge.targetConvention, edge.edgeCount);
    }
  });

  runAll();
}

export function loadConventions(db: Database.Database): ConventionGraph {
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conventions'"
    ).get();
    if (!tableExists) return { conventions: [], edges: [] };

    const conventions = (db.prepare("SELECT * FROM conventions").all() as Array<{
      id: string; name: string; layer: string; source: string; file_count: number;
    }>).map((row) => ({
      id: row.id,
      name: row.name,
      layer: row.layer as ArchLayer | "unknown",
      source: row.source as "profile" | "naming" | "pattern",
      fileCount: row.file_count,
    }));

    const edges = (db.prepare("SELECT * FROM convention_edges").all() as Array<{
      source_convention: string; target_convention: string; edge_count: number;
    }>).map((row) => ({
      sourceConvention: row.source_convention,
      targetConvention: row.target_convention,
      edgeCount: row.edge_count,
    }));

    return { conventions, edges };
  } catch {
    return { conventions: [], edges: [] };
  }
}

export function formatConventionSummary(graph: ConventionGraph): string[] {
  if (graph.conventions.length === 0) return [];

  const lines = ["Architectural Conventions:"];
  const byLayer = new Map<string, Convention[]>();

  for (const conv of graph.conventions) {
    const existing = byLayer.get(conv.layer) ?? [];
    existing.push(conv);
    byLayer.set(conv.layer, existing);
  }

  for (const [layer, convs] of byLayer) {
    const names = convs.map((c) => `${c.name} (${c.fileCount})`).join(", ");
    lines.push(`  ${layer}: ${names}`);
  }

  if (graph.edges.length > 0) {
    const topEdges = graph.edges
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, 5);
    lines.push("Top dependency flows:");
    for (const edge of topEdges) {
      lines.push(`  ${edge.sourceConvention} -> ${edge.targetConvention} (${edge.edgeCount} edges)`);
    }
  }

  return lines;
}
