import type Database from "better-sqlite3";
import type { ScoredNode } from "../core/types.js";
import type { ArchLayer, RetrievalLane } from "../core/repo-profiler.js";
import { classifyFileLayer } from "../core/repo-profiler.js";
import { fileQueries } from "../db/queries/files.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("chain-coverage");

const MAX_FILL_PER_LAYER = 3;
const MIN_FILL_SCORE_FRACTION = 0.3;

export interface LayerCoverage {
  layer: ArchLayer;
  count: number;
  filled: number;
}

export interface ChainCoverageResult {
  coverages: LayerCoverage[];
  fillNodes: ScoredNode[];
  missingLayers: ArchLayer[];
}

function computeMedianScore(nodes: ScoredNode[]): number {
  if (nodes.length === 0) return 0;
  const sorted = [...nodes].map((n) => n.score).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function getLayerPathPrefixes(lanes: RetrievalLane[], layer: ArchLayer): string[] {
  const prefixes: string[] = [];
  for (const lane of lanes) {
    if (lane.layer === layer) {
      for (const prefix of lane.pathPrefixes) {
        prefixes.push(prefix.toLowerCase());
      }
    }
  }
  return prefixes;
}

export function checkChainCoverage(
  db: Database.Database,
  _projectRoot: string,
  nodes: ScoredNode[],
  expectedLayers: ArchLayer[],
  lanes: RetrievalLane[]
): ChainCoverageResult {
  if (expectedLayers.length === 0 || lanes.length === 0) {
    return { coverages: [], fillNodes: [], missingLayers: [] };
  }

  const layerCounts = new Map<ArchLayer, number>();
  for (const layer of expectedLayers) {
    layerCounts.set(layer, 0);
  }

  for (const node of nodes) {
    const layer = classifyFileLayer(lanes, node.file.path);
    if (layer && layerCounts.has(layer)) {
      layerCounts.set(layer, layerCounts.get(layer)! + 1);
    }
  }

  const missingLayers: ArchLayer[] = [];
  for (const [layer, count] of layerCounts) {
    if (count === 0) missingLayers.push(layer);
  }

  if (missingLayers.length === 0) {
    const coverages: LayerCoverage[] = [...layerCounts.entries()].map(
      ([layer, count]) => ({ layer, count, filled: 0 })
    );
    return { coverages, fillNodes: [], missingLayers: [] };
  }

  const medianScore = computeMedianScore(nodes);
  const fillScore = Math.max(medianScore * MIN_FILL_SCORE_FRACTION, 0.01);
  const fillNodes: ScoredNode[] = [];

  const files = fileQueries(db);
  const symbols = symbolQueries(db);

  const existingFileIds = new Set(nodes.map((n) => n.file.id));

  for (const layer of missingLayers) {
    const prefixes = getLayerPathPrefixes(lanes, layer);
    if (prefixes.length === 0) continue;

    let filled = 0;
    const allFiles = files.getAll();

    for (const file of allFiles) {
      if (filled >= MAX_FILL_PER_LAYER) break;
      if (existingFileIds.has(file.id)) continue;

      const normalizedPath = file.path.replace(/\\/g, "/").toLowerCase();
      const matchesLayer = prefixes.some((prefix) => normalizedPath.startsWith(prefix));
      if (!matchesLayer) continue;

      const fileSymbols = symbols.getByFileId(file.id);
      if (fileSymbols.length === 0) continue;

      const bestSymbol = fileSymbols.reduce((best, sym) =>
        sym.isExported && sym.centrality >= (best.centrality ?? 0) ? sym : best
      , fileSymbols[0]!);

      fillNodes.push({
        symbol: bestSymbol,
        file,
        score: fillScore,
        distance: 99,
        compressionLevel: 2,
        rendered: "",
        tokenCount: 0,
      });

      existingFileIds.add(file.id);
      filled++;
      layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
    }
  }

  const coverages: LayerCoverage[] = [...layerCounts.entries()].map(
    ([layer, count]) => ({
      layer,
      count,
      filled: missingLayers.includes(layer)
        ? fillNodes.filter((n) => classifyFileLayer(lanes, n.file.path) === layer).length
        : 0,
    })
  );

  if (fillNodes.length > 0) {
    log.info("chain coverage fill", {
      missingLayers,
      fillCount: fillNodes.length,
      fillScore,
    });
  }

  return { coverages, fillNodes, missingLayers };
}
