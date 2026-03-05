export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost
      );
    }
    prev.set(curr);
  }

  return prev[n]!;
}

export function correctTerm(
  term: string,
  knownTerms: string[],
  maxDistance = 2
): string | null {
  let bestTerm: string | null = null;
  let bestDist = maxDistance + 1;

  for (const known of knownTerms) {
    if (known === term) return known;

    if (Math.abs(known.length - term.length) > maxDistance) continue;

    const dist = levenshteinDistance(term, known);
    if (dist < bestDist) {
      bestDist = dist;
      bestTerm = known;
    }
  }

  return bestDist <= maxDistance ? bestTerm : null;
}
