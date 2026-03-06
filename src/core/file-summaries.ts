import type Database from "better-sqlite3";
import { splitIdentifier } from "../utils/camel-split.js";
import { getDirectoryWeight } from "../utils/directory-weights.js";
import { expandQueryWithSynonyms } from "../utils/synonyms.js";

interface SymbolRow {
  name: string;
  kind: string;
  signature: string;
  centrality: number;
  is_exported: number;
}

interface EdgeCountRow {
  count: number;
}

export interface FileSummarySearchResult {
  fileId: number;
  path: string;
}

interface SearchRow {
  file_id: number;
  path: string;
  edge_count: number;
  avg_centrality: number;
}

interface RankedSearchResult extends FileSummarySearchResult {
  exactHits: number;
  expandedHits: number;
  score: number;
}

const TEST_QUERY_TERMS = new Set([
  "test",
  "tests",
  "spec",
  "specs",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "assert",
  "assertion",
  "jest",
  "vitest",
]);

function isTestLikePath(path: string): boolean {
  const lower = path.toLowerCase().replaceAll("\\", "/");
  return (
    lower.startsWith("test/") ||
    lower.startsWith("tests/") ||
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.includes("/__tests__/") ||
    lower.includes(".test.") ||
    lower.includes(".spec.")
  );
}

function buildSummaryText(filePath: string, symbols: SymbolRow[]): string {
  const pathTokens = filePath
    .split(/[/\\.]/)
    .flatMap((segment) => [segment.toLowerCase(), ...splitIdentifier(segment)])
    .filter((t, i, arr) => t.length >= 2 && arr.indexOf(t) === i)
    .join(" ");
  const symbolNames = symbols
    .flatMap((s) => [s.name.toLowerCase(), ...splitIdentifier(s.name)])
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .join(" ");
  const signatureTokens = symbols
    .flatMap((s) => splitIdentifier(s.signature))
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .join(" ");
  const kinds = [...new Set(symbols.map((s) => s.kind))].join(" ");
  return `${pathTokens} ${symbolNames} ${signatureTokens} ${kinds}`.toLowerCase();
}

export function computeFileSummary(
  db: Database.Database,
  fileId: number
): { summaryText: string; symbolCount: number; edgeCount: number; avgCentrality: number; exportNames: string } {
  const symbols = db.prepare(
    "SELECT name, kind, signature, centrality, is_exported FROM symbols WHERE file_id = ?"
  ).all(fileId) as SymbolRow[];

  const filePath =
    (db.prepare("SELECT path FROM files WHERE id = ?").get(fileId) as { path: string } | undefined)?.path ?? "";

  const edgeCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM edges
    WHERE source_symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)
       OR target_symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)
  `).get(fileId, fileId) as EdgeCountRow;

  const exportNames = symbols
    .filter((s) => s.is_exported)
    .map((s) => s.name)
    .join(",");

  const avgCentrality =
    symbols.length === 0
      ? 0
      : symbols.reduce((acc, s) => acc + s.centrality, 0) / symbols.length;

  return {
    summaryText: buildSummaryText(filePath, symbols),
    symbolCount: symbols.length,
    edgeCount: edgeCountRow.count,
    avgCentrality,
    exportNames,
  };
}

export function upsertFileSummary(db: Database.Database, fileId: number): void {
  const { summaryText, symbolCount, edgeCount, avgCentrality, exportNames } =
    computeFileSummary(db, fileId);

  const existing = db.prepare(
    "SELECT summary_text FROM file_summaries WHERE file_id = ?"
  ).get(fileId) as { summary_text: string } | undefined;

  db.prepare(`
    INSERT INTO file_summaries (file_id, export_names, symbol_count, edge_count, avg_centrality, summary_text, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      export_names   = excluded.export_names,
      symbol_count   = excluded.symbol_count,
      edge_count     = excluded.edge_count,
      avg_centrality = excluded.avg_centrality,
      summary_text   = excluded.summary_text,
      computed_at    = excluded.computed_at
  `).run(fileId, exportNames, symbolCount, edgeCount, avgCentrality, summaryText, Date.now());

  if (existing) {
    db.prepare(
      "INSERT INTO file_summaries_fts(file_summaries_fts, rowid, summary_text) VALUES ('delete', ?, ?)"
    ).run(fileId, existing.summary_text);
  }
  db.prepare(
    "INSERT INTO file_summaries_fts(rowid, summary_text) VALUES (?, ?)"
  ).run(fileId, summaryText);
}

export function backfillSummariesIfNeeded(db: Database.Database): boolean {
  const fileCount = (db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
  if (fileCount === 0) return false;

  const summaryCount = (db.prepare("SELECT COUNT(*) as c FROM file_summaries").get() as { c: number }).c;
  if (summaryCount >= fileCount) return false;

  const fileIds = db.prepare("SELECT id FROM files WHERE id NOT IN (SELECT file_id FROM file_summaries)").all() as Array<{ id: number }>;
  if (fileIds.length === 0) return false;

  const backfill = db.transaction(() => {
    for (const row of fileIds) {
      upsertFileSummary(db, row.id);
    }
  });
  backfill();
  return true;
}

export function searchFilesByQuery(
  db: Database.Database,
  query: string,
  limit: number
): Array<{ fileId: number; path: string }> {
  const terms = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  if (!terms) return [];
  const rawWords = terms.split(/\s+/).filter((w) => w.length >= 2);
  const expandedWords = expandQueryWithSynonyms(rawWords).filter((w) => w.length >= 2);
  const exactWordSet = new Set(rawWords);
  const testFocusedQuery = rawWords.some((word) => TEST_QUERY_TERMS.has(word));
  const scored = new Map<number, SearchRow>();
  const hitCounts = new Map<number, { exactHits: number; expandedHits: number }>();

  const doSearch = (pattern: string): SearchRow[] => {
    try {
      const rows = db.prepare(`
        SELECT fs.file_id, f.path, fs.edge_count, fs.avg_centrality
        FROM file_summaries_fts fts
        JOIN file_summaries fs ON fs.file_id = fts.rowid
        JOIN files f ON f.id = fs.file_id
        WHERE file_summaries_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(pattern, limit) as SearchRow[];
      return rows;
    } catch {
      return [];
    }
  };

  const rankResults = (
    rows: SearchRow[],
    hitCounts: Map<number, { exactHits: number; expandedHits: number }> = new Map()
  ): RankedSearchResult[] => {
    const ranked = new Map<number, RankedSearchResult>();

    for (const row of rows) {
      const hits = hitCounts.get(row.file_id) ?? { exactHits: 0, expandedHits: 0 };
      const directoryWeight = getDirectoryWeight(row.path);
      const testPenalty = !testFocusedQuery && isTestLikePath(row.path) ? 0.35 : 1;
      const centralityBoost = 1 + Math.log1p(Math.max(0, row.avg_centrality));
      const edgeBoost = 1 + Math.log1p(Math.max(0, row.edge_count)) * 0.2;
      const lexicalHits = hits.exactHits * 2 + hits.expandedHits * 1.1;
      const score =
        Math.max(1, lexicalHits || 1) *
        directoryWeight *
        testPenalty *
        centralityBoost *
        edgeBoost;
      const existing = ranked.get(row.file_id);

      if (!existing || score > existing.score) {
        ranked.set(row.file_id, {
          fileId: row.file_id,
          path: row.path,
          exactHits: hits.exactHits,
          expandedHits: hits.expandedHits,
          score,
        });
      }
    }

    return [...ranked.values()]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
        if (b.expandedHits !== a.expandedHits) return b.expandedHits - a.expandedHits;
        return a.path.localeCompare(b.path);
      })
      .slice(0, limit);
  };

  const andResults = doSearch(terms);
  for (const row of andResults) {
    scored.set(row.file_id, row);
    hitCounts.set(row.file_id, {
      exactHits: Math.max(rawWords.length, 1),
      expandedHits: 0,
    });
  }

  if (rawWords.length <= 1) {
    return rankResults([...scored.values()], hitCounts).map(({ fileId, path }) => ({ fileId, path }));
  }
  const orPattern = expandedWords.map((w) => `"${w}"`).join(" OR ");
  const orResults = doSearch(orPattern);
  for (const row of orResults) {
    scored.set(row.file_id, row);
    const existing = hitCounts.get(row.file_id) ?? { exactHits: 0, expandedHits: 0 };
    hitCounts.set(row.file_id, existing);
  }
  for (const word of expandedWords) {
    const wordResults = doSearch(`"${word}"`);
    for (const result of wordResults) {
      scored.set(result.file_id, result);
      const existing = hitCounts.get(result.file_id) ?? { exactHits: 0, expandedHits: 0 };
      if (exactWordSet.has(word)) {
        existing.exactHits += 1;
      } else {
        existing.expandedHits += 1;
      }
      hitCounts.set(result.file_id, existing);
    }
  }

  return rankResults([...scored.values()], hitCounts).map(({ fileId, path }) => ({ fileId, path }));
}
