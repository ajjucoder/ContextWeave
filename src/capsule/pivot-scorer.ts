export interface PivotCandidate {
  name: string;
  signature: string;
  kind: string;
  filePath: string;
}

export interface RankedPivots {
  ranked: Map<number, number>;
  scores: number[];
}

function stemMatch(token: string, term: string): boolean {
  if (token.includes(term) || term.includes(token)) return true;
  const prefixLen = Math.min(token.length, term.length);
  for (let i = 0; i < prefixLen; i++) {
    if (token[i] !== term[i]) return i >= Math.min(5, prefixLen);
  }
  return true;
}

export function scorePivotRelevance(candidate: PivotCandidate, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;

  const sigLower = candidate.signature.toLowerCase();
  const pathLower = candidate.filePath.toLowerCase();
  const kindLower = candidate.kind.toLowerCase();

  const nameTokens = candidate.name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-./]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const pathTokens = pathLower
    .replace(/[_\-./\\]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const nameTermHits = queryTerms.filter((term) =>
    nameTokens.some((t) => stemMatch(t, term))
  ).length;
  const sigTermHits = queryTerms.filter((term) => sigLower.includes(term)).length;
  const pathTermHits = queryTerms.filter((term) =>
    pathTokens.some((t) => stemMatch(t, term))
  ).length;

  if (nameTermHits === 0 && sigTermHits === 0 && pathTermHits === 0) return 0;

  const totalTerms = queryTerms.length;

  const nameCoverage = nameTermHits / totalTerms;
  const nameScore = nameTermHits * (1 + nameCoverage * 3);

  const sigCoverage = sigTermHits / totalTerms;
  const sigScore = sigTermHits * (1 + sigCoverage) * 0.5;

  const pathCoverage = pathTermHits / totalTerms;
  const pathScore = pathTermHits * (1 + pathCoverage) * 0.3;

  const kindWeight =
    kindLower === "function" || kindLower === "class" || kindLower === "method" ? 1.2 : 1.0;

  return (nameScore + sigScore + pathScore) * kindWeight;
}

export function rankPivots(
  candidates: Array<{ id: number } & PivotCandidate>,
  queryTerms: string[],
  maxPivots: number
): Map<number, number> {
  return rankPivotsWithScores(candidates, queryTerms, maxPivots).ranked;
}

export function rankPivotsWithScores(
  candidates: Array<{ id: number } & PivotCandidate>,
  queryTerms: string[],
  maxPivots: number
): RankedPivots {
  const scored = candidates.map((c) => ({
    id: c.id,
    score: scorePivotRelevance(c, queryTerms),
  }));

  scored.sort((a, b) => b.score - a.score);

  const ranked = new Map<number, number>();
  const scores: number[] = [];
  for (const { id, score } of scored.slice(0, maxPivots)) {
    if (score > 0) {
      ranked.set(id, score);
      scores.push(score);
    }
  }
  return { ranked, scores };
}
