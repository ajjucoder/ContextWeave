interface PivotCandidate {
  name: string;
  signature: string;
  kind: string;
  filePath: string;
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

  // Split camelCase BEFORE lowercasing to preserve case boundaries
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

  let nameTermHits = 0;
  let sigTermHits = 0;
  let pathTermHits = 0;

  for (const term of queryTerms) {
    if (nameTokens.some((t) => stemMatch(t, term))) nameTermHits++;
    if (sigLower.includes(term)) sigTermHits++;
    if (pathTokens.some((t) => stemMatch(t, term))) pathTermHits++;
  }

  if (nameTermHits === 0 && sigTermHits === 0 && pathTermHits === 0) return 0;

  const totalTerms = queryTerms.length;

  // Multi-term coverage bonus: matching N/N terms = exponential boost
  const nameCoverage = nameTermHits / totalTerms;
  const nameScore = nameTermHits * (1 + nameCoverage * 3); // 1-term=2, 2/3=4.67*hits, 3/3=8*hits

  const sigCoverage = sigTermHits / totalTerms;
  const sigScore = sigTermHits * (1 + sigCoverage) * 0.5;

  const pathCoverage = pathTermHits / totalTerms;
  const pathScore = pathTermHits * (1 + pathCoverage) * 0.3;

  // Kind-based weight: functions/classes are more likely real pivots
  const kindWeight =
    kindLower === "function" || kindLower === "class" || kindLower === "method" ? 1.2 : 1.0;

  return (nameScore + sigScore + pathScore) * kindWeight;
}

export function rankPivots(
  candidates: Array<{ id: number } & PivotCandidate>,
  queryTerms: string[],
  maxPivots: number
): Map<number, number> {
  const scored = candidates.map((c) => ({
    id: c.id,
    score: scorePivotRelevance(c, queryTerms),
  }));

  scored.sort((a, b) => b.score - a.score);

  const result = new Map<number, number>();
  for (const { id, score } of scored.slice(0, maxPivots)) {
    if (score > 0) result.set(id, score);
  }
  return result;
}
