import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import { stem } from "../utils/stemmer.js";
import { trigramSimilarity } from "../utils/fuzzy.js";
import { correctTerm } from "../utils/levenshtein.js";

const logger = createLogger("BM25Index");

const STOPWORDS = new Set([
  "the", "a", "an", "is", "it", "and", "or", "of", "to", "in",
  "for", "on", "at", "by", "with", "as", "this", "that", "from", "be",
]);

const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map((t) => stem(t));
}

function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

export class BM25Index {
  private readonly db: Database.Database;
  private readonly stmtInsertTerm: Database.Statement;
  private readonly stmtDeleteTerm: Database.Statement;
  private readonly stmtGetTermDocs: Database.Statement;
  private readonly stmtGetStat: Database.Statement;
  private readonly stmtUpsertStat: Database.Statement;
  private readonly stmtGetAllDocLengths: Database.Statement;
  private readonly stmtGetDocLength: Database.Statement;
  private readonly stmtInsertDocLength: Database.Statement;
  private readonly stmtDeleteDocLength: Database.Statement;
  private readonly stmtGetDistinctTerms: Database.Statement;
  private distinctTermsCache: string[] | null = null;

  constructor(db: Database.Database) {
    this.db = db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS bm25_doc_lengths (
        observation_id INTEGER PRIMARY KEY,
        dl INTEGER NOT NULL
      )
    `);

    this.stmtInsertTerm = db.prepare(`
      INSERT OR REPLACE INTO bm25_index (term, observation_id, tf)
      VALUES (@term, @observationId, @tf)
    `);

    this.stmtDeleteTerm = db.prepare(
      "DELETE FROM bm25_index WHERE observation_id = ?"
    );

    this.stmtGetTermDocs = db.prepare(
      "SELECT observation_id, tf FROM bm25_index WHERE term = ?"
    );

    this.stmtGetStat = db.prepare(
      "SELECT value FROM bm25_stats WHERE key = ?"
    );

    this.stmtUpsertStat = db.prepare(`
      INSERT OR REPLACE INTO bm25_stats (key, value) VALUES (@key, @value)
    `);

    this.stmtGetAllDocLengths = db.prepare(
      "SELECT observation_id, dl FROM bm25_doc_lengths"
    );

    this.stmtGetDocLength = db.prepare(
      "SELECT dl FROM bm25_doc_lengths WHERE observation_id = ?"
    );

    this.stmtInsertDocLength = db.prepare(
      "INSERT OR REPLACE INTO bm25_doc_lengths (observation_id, dl) VALUES (?, ?)"
    );

    this.stmtDeleteDocLength = db.prepare(
      "DELETE FROM bm25_doc_lengths WHERE observation_id = ?"
    );

    this.stmtGetDistinctTerms = db.prepare(
      "SELECT DISTINCT term FROM bm25_index"
    );
  }

  private readStat(key: string): number {
    const row = this.stmtGetStat.get(key) as { value: string } | undefined;
    return row ? parseFloat(row.value) : 0;
  }

  private writeStat(key: string, value: number): void {
    this.stmtUpsertStat.run({ key, value: String(value) });
  }

  indexObservation(observationId: number, text: string): void {
    const tokens = tokenize(text);
    const dl = tokens.length;

    if (dl === 0) return;

    const tf = computeTF(tokens);

    const docCount = this.readStat("doc_count") + 1;
    const prevAvgDl = this.readStat("avg_dl");
    const newAvgDl = (prevAvgDl * (docCount - 1) + dl) / docCount;

    this.db.transaction(() => {
      this.stmtDeleteTerm.run(observationId);
      this.stmtDeleteDocLength.run(observationId);
      for (const [term, count] of tf) {
        this.stmtInsertTerm.run({
          term,
          observationId,
          tf: count,
        });
      }
      this.stmtInsertDocLength.run(observationId, dl);
      this.writeStat("doc_count", docCount);
      this.writeStat("avg_dl", newAvgDl);
    })();

    this.distinctTermsCache = null;
    logger.debug("Indexed observation", { observationId, terms: tf.size, dl });
  }

  removeObservation(observationId: number): void {
    const docCount = this.readStat("doc_count");
    if (docCount <= 0) return;

    const dlRow = this.stmtGetDocLength.get(observationId) as { dl: number } | undefined;
    const dl = dlRow?.dl ?? 0;

    const newDocCount = Math.max(0, docCount - 1);

    this.db.transaction(() => {
      this.stmtDeleteTerm.run(observationId);
      this.stmtDeleteDocLength.run(observationId);

      if (newDocCount === 0) {
        this.writeStat("doc_count", 0);
        this.writeStat("avg_dl", 0);
        return;
      }

      const prevAvgDl = this.readStat("avg_dl");
      const newAvgDl = (prevAvgDl * docCount - dl) / newDocCount;
      this.writeStat("doc_count", newDocCount);
      this.writeStat("avg_dl", Math.max(0, newAvgDl));
    })();

    this.distinctTermsCache = null;
    logger.debug("Removed observation from index", { observationId });
  }

  search(query: string, limit = 20): Array<{ observationId: number; score: number }> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const N = this.readStat("doc_count");
    const avgdl = this.readStat("avg_dl");

    if (N === 0 || avgdl === 0) return [];

    const docLengths = new Map<number, number>();
    for (const row of this.stmtGetAllDocLengths.all() as Array<{ observation_id: number; dl: number }>) {
      docLengths.set(row.observation_id, row.dl);
    }

    const scores = new Map<number, number>();

    for (const token of tokens) {
      const docs = this.stmtGetTermDocs.all(token) as Array<{ observation_id: number; tf: number }>;
      const n = docs.length;

      if (n === 0) continue;

      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);

      for (const doc of docs) {
        const tf = doc.tf;
        const dl = docLengths.get(doc.observation_id) ?? avgdl;
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (dl / avgdl));
        const termScore = idf * (numerator / denominator);
        scores.set(doc.observation_id, (scores.get(doc.observation_id) ?? 0) + termScore);
      }
    }

    return Array.from(scores.entries())
      .map(([observationId, score]) => ({ observationId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getDistinctTerms(): string[] {
    if (this.distinctTermsCache) return this.distinctTermsCache;
    this.distinctTermsCache = (
      this.stmtGetDistinctTerms.all() as Array<{ term: string }>
    ).map((r) => r.term);
    return this.distinctTermsCache;
  }

  searchWithFallback(
    query: string,
    limit = 20,
    minResults = 3
  ): Array<{ observationId: number; score: number }> {
    const results = this.search(query, limit);
    if (results.length >= minResults) return results;

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return results;

    const knownTerms = this.getDistinctTerms();
    if (knownTerms.length === 0) return results;

    const expandedTokens = new Set(queryTokens);

    for (const qt of queryTokens) {
      for (const known of knownTerms) {
        if (trigramSimilarity(qt, known) >= 0.4) {
          expandedTokens.add(known);
        }
      }
    }

    if (expandedTokens.size > queryTokens.length) {
      const expandedQuery = [...expandedTokens].join(" ");
      const trigramResults = this.search(expandedQuery, limit);
      if (trigramResults.length >= minResults) return trigramResults;
      if (trigramResults.length > results.length) {
        const correctedTokens = new Set(expandedTokens);

        for (const qt of queryTokens) {
          const corrected = correctTerm(qt, knownTerms, 2);
          if (corrected) correctedTokens.add(corrected);
        }

        if (correctedTokens.size > expandedTokens.size) {
          return this.search([...correctedTokens].join(" "), limit);
        }

        return trigramResults;
      }
    }

    const correctedTokens = new Set(expandedTokens);

    for (const qt of queryTokens) {
      const corrected = correctTerm(qt, knownTerms, 2);
      if (corrected) correctedTokens.add(corrected);
    }

    if (correctedTokens.size > expandedTokens.size) {
      const correctedQuery = [...correctedTokens].join(" ");
      return this.search(correctedQuery, limit);
    }

    return results;
  }

  rebuildStats(): void {
    const rows = this.stmtGetAllDocLengths.all() as Array<{ observation_id: number; dl: number }>;
    const docCount = rows.length;
    const avgdl =
      docCount > 0 ? rows.reduce((sum, r) => sum + r.dl, 0) / docCount : 0;

    this.writeStat("doc_count", docCount);
    this.writeStat("avg_dl", avgdl);

    logger.info("Rebuilt BM25 stats", { docCount, avgdl });
  }

  reindexAll(
    getObservationText: (observationId: number) => string | null
  ): number {
    const docRows = this.stmtGetAllDocLengths.all() as Array<{ observation_id: number }>;
    const obsIds = docRows.map((r) => r.observation_id);

    let reindexed = 0;
    for (const obsId of obsIds) {
      const text = getObservationText(obsId);
      if (!text) continue;

      this.stmtDeleteTerm.run(obsId);
      this.stmtDeleteDocLength.run(obsId);

      const tokens = tokenize(text);
      const dl = tokens.length;
      if (dl === 0) continue;

      const tf = computeTF(tokens);
      for (const [term, count] of tf) {
        this.stmtInsertTerm.run({ term, observationId: obsId, tf: count });
      }
      this.stmtInsertDocLength.run(obsId, dl);
      reindexed++;
    }

    this.rebuildStats();
    this.distinctTermsCache = null;
    logger.info("Reindexed all observations with stemming", { reindexed });
    return reindexed;
  }
}
