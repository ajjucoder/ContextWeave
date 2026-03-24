import type Database from "better-sqlite3";

export interface ContentMatch {
  symbolId: number;
  fileId: number;
  filePath: string;
}

/**
 * Escape special LIKE pattern characters (% and _) to treat them as literals.
 * Also escapes backslash to prevent escape character injection.
 * 
 * @param term - The user-provided search term
 * @returns The term with %, _, and \ escaped with a backslash
 * 
 * @example
 * escapeLikePattern("100%") // returns "100\%"
 * escapeLikePattern("file_name") // returns "file\_name"
 * escapeLikePattern("C:\\Users") // returns "C:\\\\Users"
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

export function contentFallbackSearch(
  db: Database.Database,
  queryTerms: string[],
  maxFiles: number = 10
): ContentMatch[] {
  if (queryTerms.length === 0) return [];

  const symbolHits = new Map<number, number>();

  const stmt = db.prepare(
    "SELECT s.id as symbolId, s.file_id as fileId, f.path as filePath FROM symbols s JOIN files f ON f.id = s.file_id WHERE LOWER(s.full_source) LIKE ? ESCAPE '\\' LIMIT 50"
  );

  for (const term of queryTerms) {
    if (term.length < 1) continue;
    const escaped = escapeLikePattern(term);
    const pattern = `%${escaped}%`;
    const rows = stmt.all(pattern) as Array<{ symbolId: number; fileId: number; filePath: string }>;
    for (const row of rows) {
      symbolHits.set(row.symbolId, (symbolHits.get(row.symbolId) ?? 0) + 1);
    }
  }

  if (symbolHits.size === 0) return [];

  // Sort by hit count and take top symbols
  const topSymbols = [...symbolHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFiles * 5)  // Get enough symbols from top files
    .map(([symbolId]) => symbolId);

  if (topSymbols.length === 0) return [];

  const placeholders = topSymbols.map(() => "?").join(",");
  const symbolRows = db
    .prepare(
      `SELECT s.id as symbolId, s.file_id as fileId, f.path as filePath FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.id IN (${placeholders})`
    )
    .all(...topSymbols) as ContentMatch[];

  return symbolRows;
}
