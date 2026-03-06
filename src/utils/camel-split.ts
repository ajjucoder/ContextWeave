export function splitIdentifier(name: string): string[] {
  if (!name) return [];

  const parts = name.split(/[_\-./]+/).filter((p) => p.length > 0);

  const splitCamel = (token: string): string[] => {
    const result: string[] = [];
    let current = "";

    for (let i = 0; i < token.length; i++) {
      const ch = token[i]!;
      const next = token[i + 1];
      const prev = token[i - 1];

      if (i === 0) {
        current += ch;
        continue;
      }

      const chIsUpper = ch >= "A" && ch <= "Z";
      const prevIsUpper = prev !== undefined && prev >= "A" && prev <= "Z";
      const nextIsLower = next !== undefined && next >= "a" && next <= "z";
      const prevIsLower = prev !== undefined && prev >= "a" && prev <= "z";

      if (chIsUpper && prevIsLower) {
        result.push(current);
        current = ch;
      } else if (chIsUpper && prevIsUpper && nextIsLower) {
        result.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }

    if (current.length > 0) result.push(current);
    return result;
  };

  const tokens = parts.flatMap(splitCamel);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.length >= 2 && !seen.has(lower)) {
      seen.add(lower);
      unique.push(lower);
    }
  }

  return unique;
}
