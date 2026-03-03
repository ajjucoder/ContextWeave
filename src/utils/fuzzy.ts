function trigrams(str: string): Set<string> {
  const normalized = str.toLowerCase();
  const result = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    result.add(normalized.slice(i, i + 3));
  }
  return result;
}

export function trigramSimilarity(a: string, b: string): number {
  const trigramsA = trigrams(a);
  const trigramsB = trigrams(b);

  if (trigramsA.size === 0 || trigramsB.size === 0) {
    return a.toLowerCase() === b.toLowerCase() ? 1.0 : 0.0;
  }

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersection++;
  }

  const union = trigramsA.size + trigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function fuzzyMatch(query: string, candidates: string[], threshold = 0.7): Array<{ name: string; score: number }> {
  const results: Array<{ name: string; score: number }> = [];
  const queryLower = query.toLowerCase();

  for (const candidate of candidates) {
    const candidateLower = candidate.toLowerCase();
    if (candidateLower === queryLower) {
      results.push({ name: candidate, score: 1.0 });
      continue;
    }
    if (candidateLower.includes(queryLower)) {
      results.push({ name: candidate, score: 0.9 });
      continue;
    }

    const score = trigramSimilarity(query, candidate);
    if (score >= threshold) {
      results.push({ name: candidate, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
