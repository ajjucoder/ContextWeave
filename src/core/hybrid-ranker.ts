import type Database from "better-sqlite3";
import { splitIdentifier } from "../utils/camel-split.js";
import { termWeight } from "../capsule/signals.js";
import type { EmbeddingRuntime, HybridSearchResult, SymbolKind } from "./types.js";
import { symbolQueries } from "../db/queries/symbols.js";
import { globToRegExp, toProjectRelativePath, withinPath } from "../mcp/tools/path-filters.js";

const RRF_K = 60;
const BM25_WEIGHT = 1;
const VECTOR_WEIGHT = 1;
const EXACT_WEIGHT = 2;

export interface HybridSearchOptions {
  query: string;
  queryTerms: string[];
  idfWeights?: Map<string, number>;
  queryEmbedding: Float32Array;
  limit?: number;
  pathRestriction?: string;
  glob?: string;
  projectRoot?: string;
  recencyBoost?: boolean;
}

interface ChunkRow {
  id: number;
  file_id: number;
  file_path: string;
  start_line: number;
  end_line: number;
  scope_chain: string;
  symbol_ids: string;
  symbol_kinds: string;
}

interface RankedChunkSeed {
  chunkId: number;
  rank: number;
  fileId: number;
  filePath: string;
  startLine: number;
  endLine: number;
  scopeChain: string[];
  symbolIds: number[];
  kind: SymbolKind | "chunk";
}

interface SymbolIdRow {
  id: number;
  kind: SymbolKind;
}

function normalizeTerm(term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  return trimmed;
}

function uniqueTerms(query: string, queryTerms: string[]): string[] {
  const tokens = [
    query,
    ...queryTerms,
    ...splitIdentifier(query),
    ...query.split(/[^A-Za-z0-9_$.]+/g),
  ]
    .map(normalizeTerm)
    .filter((term): term is string => term !== null);

  return [...new Set(tokens)];
}

function filterByPath(
  filePath: string,
  projectRoot?: string,
  pathRestriction?: string,
  glob?: string
): boolean {
  const relativePath = projectRoot ? toProjectRelativePath(projectRoot, filePath) : filePath;
  if (pathRestriction && !withinPath(relativePath, pathRestriction)) {
    return false;
  }
  if (glob && !globToRegExp(glob).test(relativePath)) {
    return false;
  }
  return true;
}

function parseJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function computeRecencyScore(mtime: number, now: number): number {
  const ageMs = now - mtime;
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs) return 0.01;
  if (ageMs <= dayMs * 7) return 0.005;
  return 0;
}

function rrfTerm(rank: number | null, weight: number): number {
  if (rank === null) return 0;
  return weight * (1 / (RRF_K + rank));
}

export async function hybridSearch(
  db: Database.Database,
  embeddingRuntime: EmbeddingRuntime,
  options: HybridSearchOptions
): Promise<HybridSearchResult[]> {
  const limit = Math.max(1, options.limit ?? 30);
  const terms = uniqueTerms(options.query, options.queryTerms);
  const symbols = symbolQueries(db);
  const vectorLimit = Math.max(limit * 3, 24);
  const chunkForSymbol = db.prepare<[number, number, number], ChunkRow>(`
    SELECT
      c.id,
      c.file_id,
      f.path AS file_path,
      c.start_line,
      c.end_line,
      c.scope_chain,
      COALESCE(
        (
          SELECT json_group_array(s.id)
          FROM symbols s
          WHERE s.file_id = c.file_id
            AND s.start_line >= c.start_line
            AND s.end_line <= c.end_line
        ),
        '[]'
      ) AS symbol_ids,
      COALESCE(
        (
          SELECT json_group_array(s.kind)
          FROM symbols s
          WHERE s.file_id = c.file_id
            AND s.start_line >= c.start_line
            AND s.end_line <= c.end_line
        ),
        '[]'
      ) AS symbol_kinds
    FROM chunks c
    INNER JOIN files f ON f.id = c.file_id
    WHERE c.file_id = ?
      AND c.start_line <= ?
      AND c.end_line >= ?
    ORDER BY (c.end_line - c.start_line) ASC, c.chunk_index ASC
    LIMIT 1
  `);
  const fileMtime = db.prepare<[number], { mtime: number }>("SELECT mtime FROM files WHERE id = ?");
  const symbolsForRange = db.prepare<[number, number, number], SymbolIdRow>(`
    SELECT id, kind
    FROM symbols
    WHERE file_id = ?
      AND start_line >= ?
      AND end_line <= ?
    ORDER BY centrality DESC, (end_line - start_line) ASC, start_line ASC
    LIMIT 8
  `);

  const resolveChunk = (
    fileId: number,
    line: number,
    rank: number
  ): RankedChunkSeed | null => {
    const row = chunkForSymbol.get(fileId, line, line);
    if (!row) return null;
    if (!filterByPath(row.file_path, options.projectRoot, options.pathRestriction, options.glob)) {
      return null;
    }
    const symbolIds = parseJsonArray<number>(row.symbol_ids, []);
    const symbolKinds = parseJsonArray<SymbolKind>(row.symbol_kinds, []);
    return {
      chunkId: row.id,
      rank,
      fileId: row.file_id,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      scopeChain: parseJsonArray<string>(row.scope_chain, []),
      symbolIds,
      kind: symbolKinds[0] ?? "chunk",
    };
  };

  const resolveVectorSymbols = (
    fileId: number,
    startLine: number,
    endLine: number,
    entityNames: string[],
    scopeChain: string[]
  ): { symbolIds: number[]; kind: SymbolKind | "chunk" } => {
    const inRange = symbolsForRange.all(fileId, startLine, endLine);
    if (inRange.length > 0) {
      return {
        symbolIds: inRange.map((row) => row.id),
        kind: inRange[0]?.kind ?? "chunk",
      };
    }

    const seen = new Set<number>();
    const symbolIds: number[] = [];
    let kind: SymbolKind | "chunk" = "chunk";
    for (const name of [...entityNames, ...scopeChain]) {
      const symbol = symbols.getByFileAndName(fileId, name);
      if (!symbol || seen.has(symbol.id)) continue;
      seen.add(symbol.id);
      symbolIds.push(symbol.id);
      if (kind === "chunk") {
        kind = symbol.kind;
      }
      if (symbolIds.length >= 8) break;
    }

    return { symbolIds, kind };
  };

  const exactSeeds = new Map<number, RankedChunkSeed>();
  let exactRank = 1;
  for (const term of terms) {
    for (const match of symbols.getByNameCI(term)) {
      const seed = resolveChunk(match.fileId, match.startLine, exactRank);
      if (!seed || exactSeeds.has(seed.chunkId)) continue;
      exactSeeds.set(seed.chunkId, seed);
      exactRank += 1;
      if (exactSeeds.size >= limit * 2) break;
    }
    if (exactSeeds.size >= limit * 2) break;
  }

  const bm25Seeds = new Map<number, RankedChunkSeed>();
  const bm25Scores = new Map<number, { seed: RankedChunkSeed; score: number }>();
  for (const term of [...terms].sort((a, b) => termWeight(b, options.idfWeights) - termWeight(a, options.idfWeights))) {
    if (term.length < 3) continue;
    const weight = termWeight(term, options.idfWeights);
    let localRank = 1;
    for (const match of symbols.searchFTS(term, limit * 3)) {
      const seed = resolveChunk(match.fileId, match.startLine, localRank);
      if (!seed) continue;
      const existing = bm25Scores.get(seed.chunkId);
      bm25Scores.set(seed.chunkId, {
        seed: existing?.seed ?? seed,
        score: (existing?.score ?? 0) + weight / (localRank + 2),
      });
      localRank += 1;
    }
  }
  [...bm25Scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 3)
    .forEach((entry, index) => {
      bm25Seeds.set(entry.seed.chunkId, { ...entry.seed, rank: index + 1 });
    });

  const vectorSeeds = new Map<number, RankedChunkSeed>();
  const vectorResults = embeddingRuntime.vectorStore.search(options.queryEmbedding, vectorLimit);
  let vectorRank = 1;
  for (const result of vectorResults) {
    if (!filterByPath(result.filePath, options.projectRoot, options.pathRestriction, options.glob)) {
      continue;
    }
    if (vectorSeeds.has(result.chunkId)) {
      continue;
    }
    const resolved = resolveVectorSymbols(
      result.fileId,
      result.startLine,
      result.endLine,
      result.entityNames,
      result.scopeChain
    );
    vectorSeeds.set(result.chunkId, {
      chunkId: result.chunkId,
      rank: vectorRank,
      fileId: result.fileId,
      filePath: result.filePath,
      startLine: result.startLine,
      endLine: result.endLine,
      scopeChain: result.scopeChain,
      symbolIds: resolved.symbolIds,
      kind: resolved.kind,
    });
    vectorRank += 1;
    if (vectorSeeds.size >= vectorLimit) break;
  }

  const allChunkIds = new Set<number>([
    ...exactSeeds.keys(),
    ...bm25Seeds.keys(),
    ...vectorSeeds.keys(),
  ]);
  const now = Date.now();
  const results: HybridSearchResult[] = [];

  for (const chunkId of allChunkIds) {
    const exact = exactSeeds.get(chunkId);
    const bm25 = bm25Seeds.get(chunkId);
    const vector = vectorSeeds.get(chunkId);
    const seed = exact ?? bm25 ?? vector;
    if (!seed) continue;

    const mtime = fileMtime.get(seed.fileId)?.mtime ?? 0;
    const recencyScore = options.recencyBoost === false ? 0 : computeRecencyScore(mtime, now);
    const rrfScore =
      rrfTerm(bm25?.rank ?? null, BM25_WEIGHT) +
      rrfTerm(vector?.rank ?? null, VECTOR_WEIGHT) +
      rrfTerm(exact?.rank ?? null, EXACT_WEIGHT) +
      recencyScore;

    const symbolIds = seed.symbolIds.length > 0
      ? seed.symbolIds
      : vector?.symbolIds ?? [];
    const kind = seed.kind === "chunk" && exact?.kind
      ? exact.kind
      : seed.kind === "chunk" && bm25?.kind
        ? bm25.kind
        : seed.kind;

    results.push({
      fileId: seed.fileId,
      filePath: seed.filePath,
      symbolIds,
      chunkId,
      startLine: seed.startLine,
      endLine: seed.endLine,
      scopeChain: seed.scopeChain,
      kind,
      bm25Rank: bm25?.rank ?? null,
      vectorRank: vector?.rank ?? null,
      exactMatchRank: exact?.rank ?? null,
      rrfScore,
      recencyScore,
    });
  }

  results.sort((left, right) => {
    if (right.rrfScore !== left.rrfScore) {
      return right.rrfScore - left.rrfScore;
    }
    if ((left.exactMatchRank ?? Number.POSITIVE_INFINITY) !== (right.exactMatchRank ?? Number.POSITIVE_INFINITY)) {
      return (left.exactMatchRank ?? Number.POSITIVE_INFINITY) - (right.exactMatchRank ?? Number.POSITIVE_INFINITY);
    }
    if ((left.bm25Rank ?? Number.POSITIVE_INFINITY) !== (right.bm25Rank ?? Number.POSITIVE_INFINITY)) {
      return (left.bm25Rank ?? Number.POSITIVE_INFINITY) - (right.bm25Rank ?? Number.POSITIVE_INFINITY);
    }
    if ((left.vectorRank ?? Number.POSITIVE_INFINITY) !== (right.vectorRank ?? Number.POSITIVE_INFINITY)) {
      return (left.vectorRank ?? Number.POSITIVE_INFINITY) - (right.vectorRank ?? Number.POSITIVE_INFINITY);
    }
    return left.chunkId - right.chunkId;
  });

  if (embeddingRuntime.reranker && results.length > 1) {
    const rerankCandidates = results.slice(0, Math.min(30, results.length));
    const documents = rerankCandidates.map((r) => {
      const scopeLabel = r.scopeChain[r.scopeChain.length - 1] ?? r.kind;
      return `${scopeLabel} in ${r.filePath}`;
    });

    try {
      const reranked = await embeddingRuntime.reranker.rerank(options.query, documents);
      const rerankedResults: HybridSearchResult[] = [];
      const rerankedIndices = new Set<number>();

      for (const { index, score } of reranked) {
        const original = rerankCandidates[index];
        if (!original) continue;
        rerankedResults.push({
          ...original,
          rrfScore: original.rrfScore * 0.4 + score * 0.6,
        });
        rerankedIndices.add(index);
      }

      const remaining = results.filter((_, i) => i >= rerankCandidates.length || !rerankedIndices.has(i));
      rerankedResults.push(...remaining);
      rerankedResults.sort((a, b) => b.rrfScore - a.rrfScore);
      return rerankedResults.slice(0, limit);
    } catch {
      // Fall through to RRF-only ranking
    }
  }

  return results.slice(0, limit);
}
