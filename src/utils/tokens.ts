const CHARS_PER_TOKEN = 3.5;

export function countTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function tokenBudgetToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}

export function fitsInBudget(text: string, remainingTokens: number): boolean {
  return countTokens(text) <= remainingTokens;
}
