export function extractPathTerms(filePath: string): string[] {
  return filePath
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[/\\\-_.]+/)
    .filter((t) => t.length > 2);
}

export function filePathMatchesQueryTerms(filePath: string, queryTerms: string[]): boolean {
  const pathTerms = extractPathTerms(filePath);
  const matchedTerms = queryTerms.filter((qt) =>
    pathTerms.some((pt) => pt === qt || pt.includes(qt))
  );
  const specificTerms = queryTerms.filter((t) => t.length >= 6);
  return (
    matchedTerms.length >= 2 ||
    specificTerms.some((qt) => pathTerms.some((pt) => pt === qt || pt.includes(qt)))
  );
}
