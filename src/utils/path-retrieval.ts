const FRAMEWORK_ENTRY_EXT = String.raw`\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$`;
const FRAMEWORK_ENTRY_RE = new RegExp(
  `(^|/)middleware${FRAMEWORK_ENTRY_EXT}|/app/.+/route${FRAMEWORK_ENTRY_EXT}|/app/.+/(page|layout)${FRAMEWORK_ENTRY_EXT}`
);
const NEXT_ROUTE_FILE_RE = new RegExp(`/app/api/.+/route${FRAMEWORK_ENTRY_EXT}`);
const REQUEST_DYNAMIC_SEGMENT = "__cw_dynamic__";

export function normalizeRetrievalPath(filePath: string, maxSegments = 4): string {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return normalized;
  if (segments.length <= maxSegments) {
    return normalized.replace(/^\/+/, "");
  }
  return segments.slice(-maxSegments).join("/");
}

export function isFrameworkEntryPath(filePath: string): boolean {
  return FRAMEWORK_ENTRY_RE.test(normalizeRetrievalPath(filePath, 6).toLowerCase());
}

export function sanitizeFrameworkRequestPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  const withoutOrigin = trimmed.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const withoutQuery = withoutOrigin.split(/[?#]/, 1)[0] ?? withoutOrigin;
  const dynamicNormalized = withoutQuery.replace(/\$\{[^}]+\}/g, REQUEST_DYNAMIC_SEGMENT);
  return dynamicNormalized.replace(/\/+/g, "/");
}

function splitRequestSegments(requestPath: string): string[] {
  const normalized = sanitizeFrameworkRequestPath(requestPath).replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? normalized.split("/") : [];
}

function splitNextRouteSegments(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/\/app\/api\/(.+)\/route\.[^/]+$/i);
  if (!match) return [];
  return match[1]?.split("/").filter(Boolean) ?? [];
}

function isDynamicRouteSegment(segment: string): boolean {
  return /^\[[^/]+\]$/.test(segment);
}

export function matchesNextApiRouteFile(filePath: string, requestPath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (!NEXT_ROUTE_FILE_RE.test(normalizedPath)) {
    return false;
  }

  const requestSegments = splitRequestSegments(requestPath);
  if (requestSegments[0] !== "api") {
    return false;
  }

  const routeSegments = splitNextRouteSegments(normalizedPath);
  const apiSegments = requestSegments.slice(1);
  if (routeSegments.length !== apiSegments.length) {
    return false;
  }

  return routeSegments.every((routeSegment, index) => {
    const requestSegment = apiSegments[index];
    if (!requestSegment) return false;
    if (routeSegment === requestSegment) return true;
    if (requestSegment === REQUEST_DYNAMIC_SEGMENT) return isDynamicRouteSegment(routeSegment);
    return isDynamicRouteSegment(routeSegment);
  });
}

export function extractPathTerms(filePath: string): string[] {
  // Strip extension, then split on path separators and common delimiters
  const withoutExt = normalizeRetrievalPath(filePath, 6).replace(/\.[^.]+$/, "");
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
