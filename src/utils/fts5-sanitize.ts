/**
 * FTS5 Sanitization Utilities
 * 
 * These functions sanitize user input for safe use in SQLite FTS5 MATCH expressions.
 * They prevent FTS5 query injection by removing all special characters.
 * 
 * FTS5 operators neutralized:
 *   - " (double quote) - phrase grouping
 *   - * (asterisk) - prefix matching
 *   - ^ (caret) - initial character matching
 *   - AND, OR, NOT - boolean operators (treated as literals)
 *   - NEAR/n - proximity operator (treated as literal)
 */

/**
 * Sanitizes a user input term for safe use in FTS5 MATCH expressions.
 * Removes all non-alphanumeric characters (except underscore and whitespace)
 * to prevent FTS5 query injection.
 * 
 * @param term - User input to sanitize
 * @returns Sanitized term safe for FTS5 MATCH
 */
export function sanitizeFTS5Term(term: string): string {
  // Remove all non-alphanumeric characters except underscore and whitespace
  // This covers: " * ^ / ( ) . - and any other FTS5 special chars
  return term
    .replace(/[^a-zA-Z0-9_\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds an FTS5 OR pattern from multiple terms.
 * Each term is individually sanitized and quoted.
 * 
 * @param terms - Array of terms to combine with OR
 * @returns FTS5 OR pattern string, or empty string if no valid terms
 */
export function buildFTS5ORPattern(terms: string[]): string {
  const sanitized = terms.map(sanitizeFTS5Term).filter((t) => t.length >= 2);
  if (sanitized.length === 0) return "";
  if (sanitized.length === 1) return `"${sanitized[0]}"`;

  // Since we strip all quotes, no escaping needed
  return sanitized.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Builds an FTS5 phrase pattern from a full query string.
 * Splits on whitespace and creates an OR pattern from valid tokens.
 * 
 * @param query - Full query string to sanitize
 * @returns FTS5 OR pattern string, or empty string if no valid tokens
 */
export function buildFTS5QueryPattern(query: string): string {
  const sanitized = sanitizeFTS5Term(query);
  if (!sanitized) return "";

  const tokens = sanitized.split(/\s+/).filter((t) => t.length >= 2);
  return buildFTS5ORPattern(tokens);
}
