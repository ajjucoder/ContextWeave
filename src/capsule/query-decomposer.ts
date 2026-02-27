const STOP_WORDS = new Set(["a", "an", "the", "in", "on", "at", "for", "of", "with", "and", "or", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "can", "from", "to", "by", "as", "into", "about", "between", "through"]);

const MAX_TERMS_PER_GROUP = 3;
const MIN_TERMS_TO_SPLIT = 4;

export function decomposeQuery(query: string): string[][] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  if (terms.length === 0) return [];
  if (terms.length < MIN_TERMS_TO_SPLIT) return [terms];

  const groups: string[][] = [];
  let i = 0;
  while (i < terms.length) {
    groups.push(terms.slice(i, i + MAX_TERMS_PER_GROUP));
    i += MAX_TERMS_PER_GROUP;
  }
  return groups;
}

export function mergeSubQueryTerms(groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const term of group) {
      if (!seen.has(term)) {
        seen.add(term);
        result.push(term);
      }
    }
  }
  return result;
}
