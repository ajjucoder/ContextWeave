import type Database from "better-sqlite3";

interface SymbolRow {
  name: string;
  kind: string;
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

function buildSummaryText(filePath: string, symbols: SymbolRow[]): string {
  const pathTokens = filePath.replace(/[/\\.]/g, " ").replace(/-/g, " ");
  const symbolNames = symbols.map((s) => s.name).join(" ");
  const kinds = [...new Set(symbols.map((s) => s.kind))].join(" ");
  return `${pathTokens} ${symbolNames} ${kinds}`.toLowerCase();
}

export function computeFileSummary(
  db: Database.Database,
  fileId: number
): { summaryText: string; symbolCount: number; edgeCount: number; avgCentrality: number; exportNames: string } {
  const symbols = db.prepare(
    "SELECT name, kind, centrality, is_exported FROM symbols WHERE file_id = ?"
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

  const doSearch = (pattern: string): Array<{ fileId: number; path: string }> => {
    try {
      const rows = db.prepare(`
        SELECT fs.file_id, f.path
        FROM file_summaries_fts fts
        JOIN file_summaries fs ON fs.file_id = fts.rowid
        JOIN files f ON f.id = fs.file_id
        WHERE file_summaries_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(pattern, limit) as Array<{ file_id: number; path: string }>;
      return rows.map((r) => ({ fileId: r.file_id, path: r.path }));
    } catch {
      return [];
    }
  };

  const andResults = doSearch(terms);
  if (andResults.length > 0) return andResults;

  const words = terms.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length <= 1) return andResults;

  const orPattern = words.map((w) => `"${w}"`).join(" OR ");
  const orResults = doSearch(orPattern);
  if (orResults.length > 0) return orResults;

  const scored = new Map<number, { fileId: number; path: string; hits: number }>();
  for (const word of words) {
    const wordResults = doSearch(`"${word}"`);
    for (const result of wordResults) {
      const existing = scored.get(result.fileId);
      if (existing) {
        existing.hits++;
      } else {
        scored.set(result.fileId, { ...result, hits: 1 });
      }
    }
  }

  return [...scored.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map(({ fileId, path }) => ({ fileId, path }));
}
