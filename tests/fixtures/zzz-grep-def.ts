export function buildSessionToken(userId: string): string {
  return `session:${userId}`;
}
