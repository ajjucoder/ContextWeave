import { buildSessionToken } from "./zzz-grep-def";

export function renderSessionToken(userId: string): string {
  return buildSessionToken(userId);
}
