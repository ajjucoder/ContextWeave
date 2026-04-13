import type { FileRecord, LightSymbolRecord } from "../../core/types.js";
import { scorePivotRelevance } from "../pivot-scorer.js";

export interface RankedCandidate {
  symbol: LightSymbolRecord;
  file: FileRecord;
  score: number;
  distance: number;
  isPivot: boolean;
  lexicalScore: number;
  degree: number;
}

interface EnsureCandidateFileAnchorsOptions {
  intent: "narrow" | "broad" | "task" | "debug" | "symbol-lookup";
  topCandidateFiles: FileRecord[];
  ranked: RankedCandidate[];
  getFileSymbols(fileId: number): LightSymbolRecord[];
  pivotQueryTerms: string[];
}

function visibilityRank(visibility?: LightSymbolRecord["visibility"]): number {
  if (visibility === "public" || visibility === undefined) return 0;
  if (visibility === "internal") return 1;
  if (visibility === "protected") return 2;
  return 3;
}

function scoreAnchoredSymbol(symbol: LightSymbolRecord, lexicalScore: number): number {
  return lexicalScore * 6 + Math.min(1, symbol.centrality * 20) + (symbol.isExported ? 0.35 : 0);
}

function getAnchorKindWeight(kind: string): number {
  const normalizedKind = kind.toLowerCase();
  if (normalizedKind === "function" || normalizedKind === "method") return 1.3;
  if (normalizedKind === "class") return 1.15;
  if (normalizedKind === "variable") return 0.8;
  if (normalizedKind === "interface" || normalizedKind === "type") return 0.6;
  return 1;
}

export function ensureCandidateFileAnchors(
  selectedCandidates: RankedCandidate[],
  options: EnsureCandidateFileAnchorsOptions
): RankedCandidate[] {
  if (
    !(options.intent === "broad" || options.intent === "task") ||
    options.pivotQueryTerms.length === 0 ||
    options.topCandidateFiles.length === 0
  ) {
    return selectedCandidates;
  }

  const anchored = [...selectedCandidates];
  const selectedIds = new Set(anchored.map((candidate) => candidate.symbol.id));
  const maxCandidateFiles = options.intent === "broad" ? 8 : 6;

  for (const [fileIndex, file] of options.topCandidateFiles.slice(0, maxCandidateFiles).entries()) {
    const fileSymbols = options.getFileSymbols(file.id);
    if (fileSymbols.length === 0) continue;

    const rankedSymbols = fileSymbols
      .map((symbol) => ({
        symbol,
        lexicalScore: scorePivotRelevance(
          {
            name: symbol.name,
            signature: symbol.signature,
            kind: symbol.kind,
            filePath: file.path,
          },
          options.pivotQueryTerms
        ),
        anchorPriority: 0,
      }))
      .map((entry) => ({
        ...entry,
        anchorPriority: entry.lexicalScore * getAnchorKindWeight(entry.symbol.kind),
      }))
      .filter((entry) => entry.lexicalScore > 0)
      .sort((a, b) => {
        if (b.anchorPriority !== a.anchorPriority) return b.anchorPriority - a.anchorPriority;
        if (b.lexicalScore !== a.lexicalScore) return b.lexicalScore - a.lexicalScore;
        const visibilityDiff = visibilityRank(a.symbol.visibility) - visibilityRank(b.symbol.visibility);
        if (visibilityDiff !== 0) return visibilityDiff;
        if (a.symbol.isExported !== b.symbol.isExported) return a.symbol.isExported ? -1 : 1;
        if (b.symbol.centrality !== a.symbol.centrality) return b.symbol.centrality - a.symbol.centrality;
        return a.symbol.startLine - b.symbol.startLine;
      });

    const best = rankedSymbols[0];
    const fallbackSymbols =
      rankedSymbols.length === 0
        ? fileSymbols
            .map((symbol) => ({
              symbol,
              lexicalScore: 0,
              anchorPriority: getAnchorKindWeight(symbol.kind) + Math.min(1, symbol.centrality * 20),
            }))
            .sort((a, b) => {
              if (b.anchorPriority !== a.anchorPriority) return b.anchorPriority - a.anchorPriority;
              const visibilityDiff = visibilityRank(a.symbol.visibility) - visibilityRank(b.symbol.visibility);
              if (visibilityDiff !== 0) return visibilityDiff;
              if (a.symbol.isExported !== b.symbol.isExported) return a.symbol.isExported ? -1 : 1;
              if (b.symbol.centrality !== a.symbol.centrality) return b.symbol.centrality - a.symbol.centrality;
              return a.symbol.startLine - b.symbol.startLine;
            })
            .slice(0, 1)
        : [];
    const anchorTargetsSource = best ? rankedSymbols : fallbackSymbols;
    const primaryAnchor = anchorTargetsSource[0];
    if (!primaryAnchor) continue;

    const anchorTargets = anchorTargetsSource
      .filter((entry, index) =>
        index === 0 || entry.lexicalScore >= Math.max(4, primaryAnchor.lexicalScore * 0.65)
      )
      .slice(0, best ? 2 : 1);

    for (const [anchorIndex, target] of anchorTargets.entries()) {
      if (selectedIds.has(target.symbol.id)) continue;

      const existingFileCandidates = anchored.filter((candidate) => candidate.file.id === file.id);
      const existingBestLexical = existingFileCandidates.reduce(
        (max, candidate) => Math.max(max, candidate.lexicalScore),
        0
      );
      const existingComparableLexical = existingFileCandidates
        .filter(
          (candidate) =>
            getAnchorKindWeight(candidate.symbol.kind) >= getAnchorKindWeight(target.symbol.kind)
        )
        .reduce((max, candidate) => Math.max(max, candidate.lexicalScore), 0);
      const existingBestScore = existingFileCandidates.reduce(
        (max, candidate) => Math.max(max, candidate.score),
        0
      );
      if (
        anchorIndex === 0 &&
        existingFileCandidates.length > 0 &&
        existingComparableLexical >= Math.max(2, target.lexicalScore * 0.8) &&
        existingBestLexical >= Math.max(2, target.lexicalScore * 0.65)
      ) {
        continue;
      }

      const rankedMatch = options.ranked.find((candidate) => candidate.symbol.id === target.symbol.id);
      const filePriorityBoost = Math.max(0.5, 1.6 - fileIndex * 0.12);
      const anchorScore = Math.max(
        scoreAnchoredSymbol(target.symbol, target.lexicalScore) + filePriorityBoost * 5,
        existingBestScore + (anchorIndex === 0 ? 0.5 : 0.2)
      );
      anchored.push(
        rankedMatch
          ? {
              ...rankedMatch,
              score: Math.max(rankedMatch.score, anchorScore),
              distance: 0,
              lexicalScore: Math.max(rankedMatch.lexicalScore, target.lexicalScore),
            }
          : {
              symbol: target.symbol,
              file,
              score: anchorScore,
              distance: 0,
              isPivot: false,
              lexicalScore: target.lexicalScore,
              degree: 0,
            }
      );
      selectedIds.add(target.symbol.id);
    }
  }

  return anchored;
}
