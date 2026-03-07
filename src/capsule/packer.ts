import type { ScoredNode, CompressionLevel } from "../core/types.js";
import { renderSymbol, renderFileSummary } from "./compressor.js";
import { countTokens } from "../utils/tokens.js";

export interface PackResult {
  packed: ScoredNode[];
  observationBudget: number;
  tokensUsed: number;
  fileSummaries: string[];
}

const COMPRESSION_LEVELS: CompressionLevel[] = [0, 1, 2, 3];
const FILE_SUMMARY_MIN_SYMBOLS = 3;
const UI_ENTRY_PATH_RE = /(^|\/)(components?|views?|templates?|marketing)(\/|$)|(^|\/)(page|layout)\.[cm]?[jt]sx?$/i;
const ACTION_SIGNAL_TERMS = new Set([
  "submit",
  "create",
  "send",
  "load",
  "get",
  "save",
  "persist",
  "fetch",
  "update",
  "delete",
  "exchange",
  "verify",
  "handle",
  "route",
  "authenticate",
  "write",
  "read",
  "sync",
  "callback",
  "notify",
  "parse",
  "transform",
  "compile",
  "dispatch",
]);

function hasActionSignal(name: string, signature: string): boolean {
  const tokens = `${name} ${signature}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  return tokens.some((token) => ACTION_SIGNAL_TERMS.has(token));
}

function computeGroupPriority(nodes: ScoredNode[]): number {
  const topScore = nodes.reduce((max, node) => Math.max(max, node.score), Number.NEGATIVE_INFINITY);
  const pivotBonus = nodes.filter((node) => node.distance === 0).length * 2;
  const bridgeBonus = nodes.filter((node) => node.distance === 1).length * 0.9;
  const avgDistance =
    nodes.length === 0 ? 0 : nodes.reduce((sum, node) => sum + node.distance, 0) / nodes.length;

  return topScore + pivotBonus + bridgeBonus - avgDistance * 0.35;
}

function scoreTailNode(node: ScoredNode, primaryFileIds: ReadonlySet<number>): number {
  const newFileBonus = primaryFileIds.has(node.file.id) ? 0 : 0.5;
  const bridgeBonus =
    node.distance === 1
      ? 2
      : node.distance === 2
        ? 0.25
        : 0;

  return node.score + bridgeBonus + newFileBonus;
}

function summarizeUnpacked(
  scoredNodes: ScoredNode[],
  packed: ScoredNode[],
  codeBudget: number,
  initialTokensUsed: number
): { fileSummaries: string[]; tokensUsed: number } {
  let tokensUsed = initialTokensUsed;
  const packedIds = new Set(packed.map((n) => n.symbol.id));
  const unpackedByFile = new Map<string, { path: string; symbols: { name: string; kind: string }[] }>();

  for (const node of scoredNodes) {
    if (packedIds.has(node.symbol.id)) continue;
    const entry = unpackedByFile.get(node.file.path) ?? { path: node.file.path, symbols: [] };
    entry.symbols.push({ name: node.symbol.name, kind: node.symbol.kind });
    unpackedByFile.set(node.file.path, entry);
  }

  const fileSummaries: string[] = [];
  for (const { path, symbols } of unpackedByFile.values()) {
    if (symbols.length < FILE_SUMMARY_MIN_SYMBOLS) continue;
    const summary = renderFileSummary(path, symbols);
    const summaryTokens = countTokens(summary);
    if (tokensUsed + summaryTokens > codeBudget) continue;
    fileSummaries.push(summary);
    tokensUsed += summaryTokens;
  }

  return { fileSummaries, tokensUsed };
}

export function packNodes(
  scoredNodes: ScoredNode[],
  tokenBudget: number,
  codeRatio = 0.8,
  l3Cap = 0.3
): PackResult {
  const codeBudget = Math.floor(tokenBudget * codeRatio);
  const observationBudget = tokenBudget - codeBudget;

  const sorted = [...scoredNodes].sort((a, b) => b.score - a.score);
  const packed: ScoredNode[] = [];
  let tokensUsed = 0;
  let l3Count = 0;
  const maxL3 = Math.max(5, Math.ceil(sorted.length * l3Cap));

  for (const node of sorted) {
    const startLevel = node.compressionLevel;
    let placed = false;

    for (const level of COMPRESSION_LEVELS.slice(startLevel) as CompressionLevel[]) {
      if (level === 3 && l3Count >= maxL3) continue;

      const rendered = renderSymbol(node.symbol, node.file, level);
      const tokens = countTokens(rendered);

      if (tokensUsed + tokens <= codeBudget) {
        packed.push({
          ...node,
          compressionLevel: level,
          rendered,
          tokenCount: tokens,
        });
        tokensUsed += tokens;
        if (level === 3) l3Count++;
        placed = true;
        break;
      }
    }

    if (!placed) continue;
  }

  // Promotion pass: upgrade L3→L2→L1→L0 when budget remains
  const remainingBudget = codeBudget - tokensUsed;
  if (remainingBudget > 50) {
    const l3Indices = packed
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => node.compressionLevel === 3)
      .sort((a, b) => b.node.score - a.node.score);

    for (const { node, i } of l3Indices) {
      for (const targetLevel of [2, 1, 0] as CompressionLevel[]) {
        const rendered = renderSymbol(node.symbol, node.file, targetLevel);
        const tokens = countTokens(rendered);
        const delta = tokens - node.tokenCount;

        if (delta > 0 && tokensUsed + delta <= codeBudget) {
          packed[i] = { ...node, compressionLevel: targetLevel, rendered, tokenCount: tokens };
          tokensUsed += delta;
          break;
        }
      }
    }
  }

  const summaryResult = summarizeUnpacked(scoredNodes, packed, codeBudget, tokensUsed);

  return {
    packed,
    observationBudget,
    tokensUsed: summaryResult.tokensUsed,
    fileSummaries: summaryResult.fileSummaries,
  };
}

export function enrichL2WithDeps(
  packed: ScoredNode[],
  tokensUsed: number,
  codeBudget: number
): { packed: ScoredNode[]; tokensUsed: number } {
  let remaining = codeBudget - tokensUsed;

  const enriched = packed.map((node) => {
    if (node.compressionLevel !== 2 || !node.outgoingEdges?.length) return node;
    const rendered = renderSymbol(node.symbol, node.file, 2, node.outgoingEdges);
    const tokens = countTokens(rendered);
    const delta = tokens - node.tokenCount;
    if (delta > 0 && delta <= remaining) {
      remaining -= delta;
      return { ...node, rendered, tokenCount: tokens };
    }
    return node;
  });

  return { packed: enriched, tokensUsed: codeBudget - remaining };
}

export function packNodesStoryMode(
  scoredNodes: ScoredNode[],
  tokenBudget: number,
  codeRatio = 0.8,
  clusterBySymbolId: ReadonlyMap<number, number> = new Map()
): PackResult {
  const codeBudget = Math.floor(tokenBudget * codeRatio);
  const observationBudget = tokenBudget - codeBudget;

  if (scoredNodes.length === 0 || codeBudget <= 0) {
    return { packed: [], observationBudget, tokensUsed: 0, fileSummaries: [] };
  }

  const groups = new Map<number, ScoredNode[]>();
  for (const node of scoredNodes) {
    const clusterId = clusterBySymbolId.get(node.symbol.id) ?? -node.file.id;
    const bucket = groups.get(clusterId) ?? [];
    bucket.push(node);
    groups.set(clusterId, bucket);
  }

  const rankedGroups = [...groups.entries()]
    .map(([id, nodes]) => ({
      id,
      nodes,
      score: computeGroupPriority(nodes),
    }))
    .sort((a, b) => b.score - a.score);

  const maxPrimaryGroups = Math.max(1, Math.min(rankedGroups.length, Math.max(2, Math.floor(tokenBudget / 1000))));
  const primaryGroups = rankedGroups.slice(0, maxPrimaryGroups);

  const packed: ScoredNode[] = [];
  const packedIds = new Set<number>();
  let tokensUsed = 0;
  const maxL0Nodes = Math.max(1, Math.min(3, Math.floor(codeBudget / 1800) + 1));
  let usedL0Nodes = 0;

  for (let index = 0; index < primaryGroups.length; index++) {
    if (tokensUsed >= Math.floor(codeBudget * 0.9)) break;
    const group = primaryGroups[index];
    if (!group) continue;

    const remainingGroups = Math.max(1, primaryGroups.length - index);
    const fairShare = Math.floor((codeBudget - tokensUsed) / remainingGroups);
    const groupBudget = Math.min(codeBudget - tokensUsed, Math.floor(fairShare * 1.5));
    let groupTokens = 0;

    const sortedNodes = [...group.nodes].sort((a, b) => {
      if (a.distance === 0 && b.distance !== 0) return -1;
      if (b.distance === 0 && a.distance !== 0) return 1;
      return b.score - a.score;
    });

    const topScore = sortedNodes[0]?.score ?? 0;

    for (const node of sortedNodes) {
      if (packedIds.has(node.symbol.id)) continue;

      let preferredLevel: CompressionLevel;
      if (node.distance === 0) {
        const actionSignal = hasActionSignal(node.symbol.name, node.symbol.signature);
        preferredLevel =
          usedL0Nodes === 0 || (actionSignal && usedL0Nodes < maxL0Nodes && node.score >= topScore * 0.85)
            ? 0
            : 1;
      } else if (node.score >= topScore * 0.65) {
        preferredLevel = 1;
      } else {
        preferredLevel = 2;
      }

      const targetLevel =
        node.distance === 0 &&
        node.compressionLevel > 0 &&
        UI_ENTRY_PATH_RE.test(node.file.path)
          ? node.compressionLevel
          : preferredLevel;

      const rendered = renderSymbol(node.symbol, node.file, targetLevel);
      const tokens = countTokens(rendered);

      if (tokensUsed + tokens > codeBudget || groupTokens + tokens > groupBudget) continue;

      packed.push({
        ...node,
        compressionLevel: targetLevel,
        rendered,
        tokenCount: tokens,
      });
      if (targetLevel === 0) {
        usedL0Nodes += 1;
      }
      packedIds.add(node.symbol.id);
      groupTokens += tokens;
      tokensUsed += tokens;
    }
  }

  const primaryFileIds = new Set(packed.map((node) => node.file.id));
  const tailNodes = [...scoredNodes]
    .filter((node) => !packedIds.has(node.symbol.id))
    .sort((a, b) => {
      const priorityDelta = scoreTailNode(b, primaryFileIds) - scoreTailNode(a, primaryFileIds);
      if (priorityDelta !== 0) return priorityDelta;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.score - a.score;
    });

  for (const node of tailNodes) {
    const rendered = renderSymbol(node.symbol, node.file, 3);
    const tokens = countTokens(rendered);
    if (tokensUsed + tokens > codeBudget) continue;

    packed.push({
      ...node,
      compressionLevel: 3,
      rendered,
      tokenCount: tokens,
    });
    packedIds.add(node.symbol.id);
    tokensUsed += tokens;
  }

  const summaryResult = summarizeUnpacked(scoredNodes, packed, codeBudget, tokensUsed);

  return {
    packed,
    observationBudget,
    tokensUsed: summaryResult.tokensUsed,
    fileSummaries: summaryResult.fileSummaries,
  };
}
