import { encode } from "gpt-tokenizer";

const CHARS_PER_TOKEN_ESTIMATE = 3.5;
const TOKEN_CACHE_LIMIT = 2000;
const TOKEN_CACHE_EVICTION_RATIO = 0.1;
const tokenCache = new Map<string, number>();

function touchTokenCacheEntry(text: string, tokenCount: number): number {
  tokenCache.delete(text);
  tokenCache.set(text, tokenCount);
  return tokenCount;
}

function evictLeastRecentlyUsedEntries(): void {
  const evictionCount = Math.max(1, Math.ceil(TOKEN_CACHE_LIMIT * TOKEN_CACHE_EVICTION_RATIO));
  let evicted = 0;

  for (const key of tokenCache.keys()) {
    tokenCache.delete(key);
    evicted += 1;
    if (evicted >= evictionCount) break;
  }
}

export function countTokens(text: string): number {
  if (text.length === 0) return 0;

  const cached = tokenCache.get(text);
  if (cached !== undefined) return touchTokenCacheEntry(text, cached);

  const tokenCount = encode(text).length;
  tokenCache.set(text, tokenCount);

  if (tokenCache.size > TOKEN_CACHE_LIMIT) {
    evictLeastRecentlyUsedEntries();
  }

  return tokenCount;
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function fitsInBudget(text: string, remainingTokens: number): boolean {
  return countTokens(text) <= remainingTokens;
}
