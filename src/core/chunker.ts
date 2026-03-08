import { createChunker, type ChunkOptions } from "code-chunk";
import type Database from "better-sqlite3";
import type { PreparedChunk } from "./types.js";
import { countTokens } from "../utils/tokens.js";
import { hashFile } from "../utils/hash.js";
import { fileQueries } from "../db/queries/files.js";
import { chunkQueries } from "../db/queries/chunks.js";

type ChunkLanguage = "typescript" | "javascript" | "python" | "rust" | "go" | "java";

interface BuildChunkOptions {
  maxChunkSize?: number;
  overlapLines?: number;
  languageHint?: string | null;
}

const defaultChunker = createChunker({
  contextMode: "full",
  siblingDetail: "signatures",
  overlapLines: 4,
});

function toChunkLanguage(languageHint: string | null | undefined, filePath: string): ChunkLanguage | null {
  const explicit = languageHint?.toLowerCase();
  switch (explicit) {
    case "typescript":
    case "tsx":
      return "typescript";
    case "javascript":
    case "jsx":
      return "javascript";
    case "python":
    case "rust":
    case "go":
    case "java":
      return explicit;
    default:
      break;
  }

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return "typescript";
  }
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript";
  }
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".java")) return "java";
  return null;
}

function uniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

export async function buildEmbeddingChunks(
  filePath: string,
  source: string,
  options: BuildChunkOptions = {}
): Promise<PreparedChunk[]> {
  const language = toChunkLanguage(options.languageHint, filePath);
  if (!language) return [];

  const chunkOptions: ChunkOptions = {
    language,
    maxChunkSize: options.maxChunkSize,
    overlapLines: options.overlapLines,
  };
  const rawChunks = await defaultChunker.chunk(filePath, source, chunkOptions);

  return rawChunks.map((chunk) => ({
    chunkIndex: chunk.index,
    startLine: chunk.lineRange.start + 1,
    endLine: chunk.lineRange.end + 1,
    startByte: chunk.byteRange.start,
    endByte: chunk.byteRange.end,
    text: chunk.text,
    contextualizedText: chunk.contextualizedText,
    scopeChain: uniqueNames(chunk.context.scope.map((scope) => scope.name)),
    importSources: uniqueNames(chunk.context.imports.map((entry) => entry.source)),
    siblingNames: uniqueNames(chunk.context.siblings.map((sibling) => sibling.name)),
    entityNames: uniqueNames(chunk.context.entities.map((entity) => entity.name)),
    tokenCount: countTokens(chunk.contextualizedText),
    contentHash: hashFile(chunk.contextualizedText),
  }));
}

export async function backfillChunksIfNeeded(
  db: Database.Database,
  _projectRoot: string
): Promise<boolean> {
  const files = fileQueries(db);
  const chunks = chunkQueries(db);
  const missing = files
    .getAll()
    .filter((file) => chunks.countByFileId(file.id) === 0);

  if (missing.length === 0) return false;

  const fs = await import("node:fs/promises");

  for (const file of missing) {
    try {
      const source = await fs.readFile(file.path, "utf-8");
      const prepared = await buildEmbeddingChunks(file.path, source, {
        languageHint: file.language,
      });
      chunks.replaceForFile(file.id, prepared);
    } catch {
      // Skip files that disappeared or are no longer readable.
    }
  }

  return true;
}
