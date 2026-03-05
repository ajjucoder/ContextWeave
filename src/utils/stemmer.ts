function isConsonant(word: string, i: number): boolean {
  const c = word[i]!;
  if ("aeiou".includes(c)) return false;
  if (c === "y") return i === 0 || !isConsonant(word, i - 1);
  return true;
}

function measure(word: string): number {
  let count = 0;
  let i = 0;
  const len = word.length;
  while (i < len && isConsonant(word, i)) i++;
  if (i >= len) return 0;
  while (i < len) {
    while (i < len && !isConsonant(word, i)) i++;
    if (i >= len) break;
    count++;
    while (i < len && isConsonant(word, i)) i++;
  }
  return count;
}

function hasVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) return true;
  }
  return false;
}

function endsWithDouble(word: string): boolean {
  if (word.length < 2) return false;
  const last = word[word.length - 1]!;
  return last === word[word.length - 2] && isConsonant(word, word.length - 1);
}

function cvc(word: string): boolean {
  const len = word.length;
  if (len < 3) return false;
  if (
    !isConsonant(word, len - 1) ||
    isConsonant(word, len - 2) ||
    !isConsonant(word, len - 3)
  )
    return false;
  const last = word[len - 1]!;
  return !("wxy".includes(last));
}

function replaceSuffix(
  word: string,
  suffix: string,
  replacement: string
): string {
  return word.slice(0, -suffix.length) + replacement;
}

function step1a(word: string): string {
  if (word.endsWith("sses")) return replaceSuffix(word, "sses", "ss");
  if (word.endsWith("ies")) return replaceSuffix(word, "ies", "i");
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function step1b(word: string): string {
  if (word.endsWith("eed")) {
    const stem = replaceSuffix(word, "eed", "ee");
    return measure(stem.slice(0, -2)) > 0 ? stem : word;
  }

  let modified = "";
  if (word.endsWith("ed")) {
    const base = replaceSuffix(word, "ed", "");
    if (hasVowel(base)) modified = base;
  } else if (word.endsWith("ing")) {
    const base = replaceSuffix(word, "ing", "");
    if (hasVowel(base)) modified = base;
  }

  if (!modified) return word;

  if (modified.endsWith("at")) return modified + "e";
  if (modified.endsWith("bl")) return modified + "e";
  if (modified.endsWith("iz")) return modified + "e";
  if (endsWithDouble(modified)) {
    const last = modified[modified.length - 1]!;
    if (!"lsz".includes(last)) return modified.slice(0, -1);
  }
  if (measure(modified) === 1 && cvc(modified)) return modified + "e";

  return modified;
}

function step1c(word: string): string {
  if (
    word.endsWith("y") &&
    hasVowel(word.slice(0, -1)) &&
    word.length > 2
  ) {
    return word.slice(0, -1) + "i";
  }
  return word;
}

const step2Map: [string, string][] = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["abli", "able"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["li", ""],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
];

function step2(word: string): string {
  for (const [suffix, replacement] of step2Map) {
    if (word.endsWith(suffix)) {
      const base = replaceSuffix(word, suffix, "");
      if (measure(base) > 0) return base + replacement;
      return word;
    }
  }
  return word;
}

const step3Map: [string, string][] = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

function step3(word: string): string {
  for (const [suffix, replacement] of step3Map) {
    if (word.endsWith(suffix)) {
      const base = replaceSuffix(word, suffix, "");
      if (measure(base) > 0) return base + replacement;
      return word;
    }
  }
  return word;
}

const step4Suffixes = [
  "al", "ance", "ence", "er", "ic", "able", "ible", "ant",
  "ement", "ment", "ent", "ion", "ou", "ism", "ate", "iti",
  "ous", "ive", "ize",
];

function step4(word: string): string {
  for (const suffix of step4Suffixes) {
    if (word.endsWith(suffix)) {
      const base = replaceSuffix(word, suffix, "");
      if (suffix === "ion") {
        if (
          measure(base) > 1 &&
          base.length > 0 &&
          ("st".includes(base[base.length - 1]!))
        ) {
          return base;
        }
      } else if (measure(base) > 1) {
        return base;
      }
      return word;
    }
  }
  return word;
}

function step5a(word: string): string {
  if (word.endsWith("e")) {
    const base = word.slice(0, -1);
    if (measure(base) > 1) return base;
    if (measure(base) === 1 && !cvc(base)) return base;
  }
  return word;
}

function step5b(word: string): string {
  if (
    measure(word) > 1 &&
    endsWithDouble(word) &&
    word.endsWith("l")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

export function stem(word: string): string {
  if (word.length <= 2) return word;

  let w = word.toLowerCase();
  w = step1a(w);
  w = step1b(w);
  w = step1c(w);
  w = step2(w);
  w = step3(w);
  w = step4(w);
  w = step5a(w);
  w = step5b(w);

  return w;
}
