import { encode } from "gpt-tokenizer";

const CHARS_PER_TOKEN_ESTIMATE = 3.5;
const TOKEN_CACHE_LIMIT = 2000;
const tokenCache = new Map<string, number>();

export function countTokens(text: string): number {
  if (text.length === 0) return 0;

  const cached = tokenCache.get(text);
  if (cached !== undefined) return cached;

  const tokenCount = encode(text).length;
  tokenCache.set(text, tokenCount);

  if (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const first = tokenCache.keys().next().value as string | undefined;
    if (first !== undefined) tokenCache.delete(first);
  }

  return tokenCount;
}

export function tokenBudgetToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN_ESTIMATE);
}

export function fitsInBudget(text: string, remainingTokens: number): boolean {
  return countTokens(text) <= remainingTokens;
}
