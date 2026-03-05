const FRAMEWORK_ENTRY_EXT = String.raw`\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$`;
const FRAMEWORK_ENTRY_RE = new RegExp(
  `(^|/)middleware${FRAMEWORK_ENTRY_EXT}|/app/.+/route${FRAMEWORK_ENTRY_EXT}|/app/.+/(page|layout)${FRAMEWORK_ENTRY_EXT}`
);

export function isFrameworkEntryPath(filePath: string): boolean {
  return FRAMEWORK_ENTRY_RE.test(filePath.replace(/\\/g, "/").toLowerCase());
}

export function extractPathTerms(filePath: string): string[] {
  // Strip extension, then split on path separators and common delimiters
  const withoutExt = filePath.replace(/\.[^.]+$/, "");
  return withoutExt
    .split(/[/\\\-_.]+/)
    .flatMap((segment) =>
      // Split CamelCase BEFORE lowercasing so boundaries are detected correctly
      // "submitInquiry" → "submit Inquiry" → ["submit", "Inquiry"]
      segment.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ")
    )
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2);
}

export function filePathMatchesQueryTerms(filePath: string, queryTerms: string[]): boolean {
  const pathTerms = extractPathTerms(filePath);
  // Use exact segment matching — CamelCase splitting already handles "auth" vs "authentication"
  const matchedTerms = queryTerms.filter((qt) =>
    pathTerms.some((pt) => {
      if (pt === qt) return true;
      // Allow substring only for long, specific terms (≥8 chars) to avoid false positives
      if (qt.length >= 8 && pt.includes(qt)) return true;
      if (pt.length >= 8 && qt.includes(pt)) return true;
      return false;
    })
  );
  const specificTerms = queryTerms.filter((t) => t.length >= 6);
  return (
    matchedTerms.length >= 2 ||
    specificTerms.some((qt) =>
      pathTerms.some((pt) => {
        if (pt === qt) return true;
        if (qt.length >= 8 && pt.includes(qt)) return true;
        if (pt.length >= 8 && qt.includes(pt)) return true;
        return false;
      })
    )
  );
}
