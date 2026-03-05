# Fuzzy Search Upgrade + Session Stats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three-layer fuzzy BM25 search (Porter stemming, trigram fallback, Levenshtein correction) and a `cw_stats` session stats MCP tool to ContextWeave.

**Architecture:** Enhance the existing BM25 tokenizer with Porter stemming at index/query time (Layer 1). Add cascading fallback: trigram substring matching against known index terms (Layer 2), then Levenshtein typo correction (Layer 3). Wire fallback into `ObservationStore.searchWithScores()`. Add a new read-only `cw_stats` MCP tool that aggregates `capsule_log` data and estimates context savings. Add DB migration v7 to re-index existing observations with stemmed tokens.

**Tech Stack:** TypeScript ESM, better-sqlite3, vitest, existing BM25Index class

---

### Task 1: Porter Stemmer — Tests

**Files:**
- Create: `tests/unit/stemmer.test.ts`

**Step 1: Write the stemmer test file**

```ts
import { describe, it, expect } from "vitest";
import { stem } from "../../src/utils/stemmer.js";

describe("Porter Stemmer", () => {
  it("stems regular -ing words", () => {
    expect(stem("caching")).toBe("cach");
    expect(stem("running")).toBe("run");
    expect(stem("connecting")).toBe("connect");
    expect(stem("processing")).toBe("process");
  });

  it("stems regular -ed words", () => {
    expect(stem("cached")).toBe("cach");
    expect(stem("connected")).toBe("connect");
    expect(stem("processed")).toBe("process");
    expect(stem("walked")).toBe("walk");
  });

  it("stems regular -es/-s words", () => {
    expect(stem("caches")).toBe("cach");
    expect(stem("processes")).toBe("process");
    expect(stem("connections")).toBe("connect");
    expect(stem("tokens")).toBe("token");
  });

  it("stems -tion/-sion words", () => {
    expect(stem("authentication")).toBe("authent");
    expect(stem("connection")).toBe("connect");
    expect(stem("validation")).toBe("valid");
  });

  it("stems -ment words", () => {
    expect(stem("management")).toBe("manag");
    expect(stem("deployment")).toBe("deploy");
  });

  it("stems -ness words", () => {
    expect(stem("staleness")).toBe("stale");
    expect(stem("darkness")).toBe("dark");
  });

  it("stems -ly words", () => {
    expect(stem("quickly")).toBe("quick");
    expect(stem("manually")).toBe("manual");
  });

  it("returns short words unchanged", () => {
    expect(stem("a")).toBe("a");
    expect(stem("an")).toBe("an");
    expect(stem("db")).toBe("db");
  });

  it("returns already-stemmed words unchanged or stable", () => {
    expect(stem("auth")).toBe("auth");
    expect(stem("jwt")).toBe("jwt");
    expect(stem("sql")).toBe("sql");
    expect(stem("api")).toBe("api");
  });

  it("handles camelCase tokens (pre-lowered)", () => {
    expect(stem("validate")).toBe("valid");
    expect(stem("handler")).toBe("handler");
  });

  it("is idempotent — stemming a stem returns the same value", () => {
    const words = ["caching", "authentication", "connection", "running", "tokens"];
    for (const word of words) {
      const once = stem(word);
      const twice = stem(once);
      expect(twice).toBe(once);
    }
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stemmer.test.ts`
Expected: FAIL — cannot resolve `../../src/utils/stemmer.js`

**Step 3: Commit**

```bash
git add tests/unit/stemmer.test.ts
git commit -m "test(stemmer): add Porter Stemmer unit tests"
```

---

### Task 2: Porter Stemmer — Implementation

**Files:**
- Create: `src/utils/stemmer.ts`

**Step 1: Implement the Porter Stemmer**

```ts
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
```

**Step 2: Run the tests**

Run: `npx vitest run tests/unit/stemmer.test.ts`
Expected: PASS (all tests green)

**Step 3: Commit**

```bash
git add src/utils/stemmer.ts
git commit -m "feat(search): add Porter Stemmer implementation"
```

---

### Task 3: Levenshtein Distance — Tests

**Files:**
- Create: `tests/unit/levenshtein.test.ts`

**Step 1: Write the Levenshtein test file**

```ts
import { describe, it, expect } from "vitest";
import { levenshteinDistance, correctTerm } from "../../src/utils/levenshtein.js";

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns string length for empty vs non-empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("handles single character substitution", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
  });

  it("handles single character insertion", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  it("handles single character deletion", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("handles transposition (counts as 2 edits)", () => {
    expect(levenshteinDistance("ab", "ba")).toBe(2);
  });

  it("handles real-world typos", () => {
    expect(levenshteinDistance("kuberntes", "kubernetes")).toBe(1);
    expect(levenshteinDistance("autentication", "authentication")).toBe(1);
    expect(levenshteinDistance("databse", "database")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });
});

describe("correctTerm", () => {
  const knownTerms = ["kubernetes", "authentication", "database", "connection", "middleware"];

  it("returns exact match term unchanged", () => {
    expect(correctTerm("database", knownTerms, 2)).toBe("database");
  });

  it("corrects single-character typos", () => {
    expect(correctTerm("kuberntes", knownTerms, 2)).toBe("kubernetes");
    expect(correctTerm("databse", knownTerms, 2)).toBe("database");
  });

  it("returns null when no term is within max distance", () => {
    expect(correctTerm("zzzzzzz", knownTerms, 2)).toBeNull();
  });

  it("returns the closest match when multiple are within distance", () => {
    const result = correctTerm("connectio", knownTerms, 2);
    expect(result).toBe("connection");
  });

  it("respects maxDistance threshold", () => {
    expect(correctTerm("kuberntes", knownTerms, 0)).toBeNull();
    expect(correctTerm("kuberntes", knownTerms, 1)).toBe("kubernetes");
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/levenshtein.test.ts`
Expected: FAIL — cannot resolve `../../src/utils/levenshtein.js`

**Step 3: Commit**

```bash
git add tests/unit/levenshtein.test.ts
git commit -m "test(search): add Levenshtein distance unit tests"
```

---

### Task 4: Levenshtein Distance — Implementation

**Files:**
- Create: `src/utils/levenshtein.ts`

**Step 1: Implement Levenshtein distance and correction**

```ts
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Uint16Array(n + 1);
  const curr = new Uint16Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + cost
      );
    }
    prev.set(curr);
  }

  return prev[n]!;
}

export function correctTerm(
  term: string,
  knownTerms: string[],
  maxDistance = 2
): string | null {
  let bestTerm: string | null = null;
  let bestDist = maxDistance + 1;

  for (const known of knownTerms) {
    if (known === term) return known;

    if (Math.abs(known.length - term.length) > maxDistance) continue;

    const dist = levenshteinDistance(term, known);
    if (dist < bestDist) {
      bestDist = dist;
      bestTerm = known;
    }
  }

  return bestDist <= maxDistance ? bestTerm : null;
}
```

**Step 2: Run the tests**

Run: `npx vitest run tests/unit/levenshtein.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/utils/levenshtein.ts
git commit -m "feat(search): add Levenshtein distance and term correction"
```

---

### Task 5: BM25 Fuzzy Search — Tests

**Files:**
- Modify: `tests/unit/bm25.test.ts` (add new describe blocks)

**Step 1: Add stemmed search and fallback tests to the existing bm25.test.ts**

Append the following new `describe` blocks after the existing `describe("BM25Index", ...)` block at the end of the file:

```ts
describe("BM25 stemmed search", () => {
  it("matches morphological variants via stemming", () => {
    createObservation(db, 1);
    createObservation(db, 2);

    bm25.indexObservation(1, "caching strategy for database connections");
    bm25.indexObservation(2, "logging configuration for production");

    const results = bm25.search("cached connection");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observationId).toBe(1);
  });

  it("matches -tion/-ing variants", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "authentication middleware validates tokens");

    const results = bm25.search("authenticating");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.observationId).toBe(1);
  });
});

describe("BM25 searchWithFallback", () => {
  it("returns stemmed results without triggering fallback when enough matches exist", () => {
    createObservation(db, 1);
    createObservation(db, 2);
    createObservation(db, 3);

    bm25.indexObservation(1, "authentication middleware handler");
    bm25.indexObservation(2, "authentication token refresh logic");
    bm25.indexObservation(3, "database connection pooling setup");

    const results = bm25.searchWithFallback("authentication", 10, 2);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.observationId);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("falls back to trigram matching on partial terms", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "kubernetes deployment configuration");

    const results = bm25.searchWithFallback("kubernet", 10, 1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.observationId).toBe(1);
  });

  it("falls back to Levenshtein correction on typos", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "kubernetes cluster management");

    const results = bm25.searchWithFallback("kuberntes", 10, 1);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.observationId).toBe(1);
  });

  it("returns empty for completely unrelated queries", () => {
    createObservation(db, 1);
    bm25.indexObservation(1, "authentication middleware");

    const results = bm25.searchWithFallback("zzzznotfound", 10, 1);
    expect(results).toHaveLength(0);
  });
});
```

**Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run tests/unit/bm25.test.ts`
Expected: New stemmed/fallback tests FAIL (stemming not yet in tokenize, `searchWithFallback` doesn't exist). Existing tests may also fail because stemming changes the tokens stored — that's expected and will be fixed in the next task.

**Step 3: Commit**

```bash
git add tests/unit/bm25.test.ts
git commit -m "test(search): add stemmed search and fallback tests for BM25"
```

---

### Task 6: BM25 Fuzzy Search — Implementation

**Files:**
- Modify: `src/memory/bm25.ts:1-207` (full file rewrite)

**Step 1: Update bm25.ts with stemming, trigram fallback, and Levenshtein correction**

The changes to `src/memory/bm25.ts`:

1. **Line 2**: Add import for `stem` from `../utils/stemmer.js`
2. **Line 3**: Add import for `trigramSimilarity` from `../utils/fuzzy.js`
3. **Line 4**: Add import for `correctTerm` from `../utils/levenshtein.js`
4. **Line 14-19**: Update `tokenize()` to stem tokens after filtering stopwords
5. **After line 39**: Add fields `private stmtGetDistinctTerms: Database.Statement` and `private distinctTermsCache: string[] | null = null`
6. **In constructor**: Add `this.stmtGetDistinctTerms = db.prepare("SELECT DISTINCT term FROM bm25_index")`
7. **In `indexObservation` and `removeObservation`**: Add `this.distinctTermsCache = null` to invalidate cache
8. **After `search()` method**: Add `getDistinctTerms()` and `searchWithFallback()` methods
9. **After `rebuildStats()` method**: Add `reindexAll()` method

Here is the complete updated file:

```ts
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
```

**Step 2: Run all BM25 tests**

Run: `npx vitest run tests/unit/bm25.test.ts tests/unit/bm25-correctness.test.ts`
Expected: Some existing tests in `bm25-correctness.test.ts` may need adjustment because stored terms are now stemmed. If `bm25-correctness.test.ts:47` checks for raw term `"hello"`, it will now find `"hello"` (which stems to itself — should still pass). The term `"world"` stems to `"world"` too. Check output — if all pass, great. If any fail, fix the specific assertion in next step.

**Step 3: Fix any failing assertions in bm25-correctness.test.ts**

The test at line 47-52 checks:
```ts
const helloRow = rows.find((r) => r.term === "hello");
```

Since `stem("hello") === "hello"`, this should still pass. But `stem("consistent") === "consist"` — the test at line 100 indexes `"consistent length text here now"`. After stemming: `"consist", "length", "text", "here", "now"` — all 5 tokens, so `dl = 5` matches the assertion on line 110.

Run: `npx vitest run tests/unit/bm25-correctness.test.ts`
Expected: PASS. If any assertion fails, the fix is to update the expected term string to the stemmed version.

**Step 4: Run all BM25 tests together**

Run: `npx vitest run tests/unit/bm25.test.ts tests/unit/bm25-correctness.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/memory/bm25.ts
git commit -m "feat(search): three-layer fuzzy BM25 — stemming, trigram fallback, Levenshtein correction"
```

---

### Task 7: Wire Fallback into ObservationStore

**Files:**
- Modify: `src/memory/observations.ts:118-153` (two methods)

**Step 1: Update `search()` and `searchWithScores()` to use `searchWithFallback()`**

In `src/memory/observations.ts`, change:

- **Line 121**: `this.bm25.search(query, limit * 3)` → `this.bm25.searchWithFallback(query, limit * 3)`
- **Line 142**: `this.bm25.search(query, limit)` → `this.bm25.searchWithFallback(query, limit)`

**Step 2: Run existing observation/recall tests**

Run: `npx vitest run tests/unit/bm25.test.ts tests/unit/bm25-correctness.test.ts tests/memory/observations-update.test.ts tests/memory/recall-scope-weight.test.ts tests/integration/passive-observation-recall.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/memory/observations.ts
git commit -m "feat(search): wire fuzzy BM25 fallback into ObservationStore"
```

---

### Task 8: DB Migration v7 — Re-index with Stemming

**Files:**
- Modify: `src/db/migrations.ts:157` (add migration v7 before closing bracket of `migrations` array)

**Step 1: Add migration v7**

Insert before the closing `];` of the `migrations` array (after line 156):

```ts
  {
    version: 7,
    up(db) {
      const observations = db.prepare(
        "SELECT id, note, scope FROM observations"
      ).all() as Array<{ id: number; note: string; scope: string }>;

      if (observations.length === 0) return;

      const { BM25Index } = require("../memory/bm25.js") as { BM25Index: new (db: Database.Database) => { reindexAll: (fn: (id: number) => string | null) => number } };
      const bm25 = new BM25Index(db);

      const obsMap = new Map<number, string>();
      for (const obs of observations) {
        obsMap.set(obs.id, obs.note + " " + obs.scope);
      }

      bm25.reindexAll((id) => obsMap.get(id) ?? null);
    },
  },
```

**IMPORTANT:** Because this is ESM and we can't `require()`, use a different approach — inline the reindex logic directly in the migration using raw SQL + the stem function:

Actually, the cleaner approach: import `stem` at the top of migrations.ts and do the reindex with direct SQL. Update the migration to:

Add this import at the top of `src/db/migrations.ts` (after line 3):
```ts
import { stem } from "../utils/stemmer.js";
```

Then the migration body:

```ts
  {
    version: 7,
    up(db) {
      const observations = db.prepare(
        "SELECT id, note, scope FROM observations"
      ).all() as Array<{ id: number; note: string; scope: string }>;

      if (observations.length === 0) return;

      const STOPWORDS = new Set([
        "the", "a", "an", "is", "it", "and", "or", "of", "to", "in",
        "for", "on", "at", "by", "with", "as", "this", "that", "from", "be",
      ]);

      function tokenize(text: string): string[] {
        return text
          .toLowerCase()
          .split(/[\s\W]+/)
          .filter((t) => t.length > 0 && !STOPWORDS.has(t))
          .map((t) => stem(t));
      }

      const deleteTerm = db.prepare("DELETE FROM bm25_index WHERE observation_id = ?");
      const deleteDocLen = db.prepare("DELETE FROM bm25_doc_lengths WHERE observation_id = ?");
      const insertTerm = db.prepare("INSERT OR REPLACE INTO bm25_index (term, observation_id, tf) VALUES (@term, @observationId, @tf)");
      const insertDocLen = db.prepare("INSERT OR REPLACE INTO bm25_doc_lengths (observation_id, dl) VALUES (?, ?)");
      const upsertStat = db.prepare("INSERT OR REPLACE INTO bm25_stats (key, value) VALUES (@key, @value)");

      let totalDl = 0;
      let docCount = 0;

      for (const obs of observations) {
        const text = obs.note + " " + obs.scope;
        const tokens = tokenize(text);
        if (tokens.length === 0) continue;

        deleteTerm.run(obs.id);
        deleteDocLen.run(obs.id);

        const tf = new Map<string, number>();
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

        for (const [term, count] of tf) {
          insertTerm.run({ term, observationId: obs.id, tf: count });
        }
        insertDocLen.run(obs.id, tokens.length);
        totalDl += tokens.length;
        docCount++;
      }

      upsertStat.run({ key: "doc_count", value: String(docCount) });
      upsertStat.run({ key: "avg_dl", value: String(docCount > 0 ? totalDl / docCount : 0) });
    },
  },
```

**Step 2: Run migration tests**

Run: `npx vitest run tests/db/migrations.test.ts`
Expected: PASS

**Step 3: Run full BM25 test suite**

Run: `npx vitest run tests/unit/bm25.test.ts tests/unit/bm25-correctness.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/db/migrations.ts
git commit -m "feat(search): add migration v7 — re-index BM25 with Porter stemming"
```

---

### Task 9: Session Stats Tool — Tests

**Files:**
- Create: `tests/unit/stats.test.ts`

**Step 1: Write the stats tool tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../../src/db/schema.js";
import { runMigrations } from "../../src/db/migrations.js";
import { computeSessionStats } from "../../src/mcp/tools/stats.js";

let db: Database.Database;

function setupSession(sessionId: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO sessions (id, agent_id, project_root, started_at) VALUES (?, ?, ?, ?)"
  ).run(sessionId, "claude-code", "/test", Date.now() - 60000);
}

function insertCapsuleLog(sessionId: string, query: string, budget: number, used: number, symbols: string[], files: string[]): void {
  db.prepare(`
    INSERT INTO capsule_log (session_id, query, mode, token_budget, tokens_used, symbols_included, files_included, timestamp, followed_up, miss_ratio, noise_ratio)
    VALUES (?, ?, 'feature', ?, ?, ?, ?, ?, 0, NULL, NULL)
  `).run(sessionId, query, budget, used, JSON.stringify(symbols), JSON.stringify(files), Date.now());
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createSchema(db);
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("computeSessionStats", () => {
  it("returns zero stats for empty session", () => {
    setupSession("s1");
    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.capsulesGenerated).toBe(0);
    expect(stats.totalTokensBudgeted).toBe(0);
    expect(stats.totalTokensUsed).toBe(0);
    expect(stats.uniqueFiles).toBe(0);
    expect(stats.uniqueSymbols).toBe(0);
  });

  it("aggregates capsule log entries correctly", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "auth middleware", 4000, 2400, ["validateToken", "authGuard"], ["src/auth.ts", "src/guard.ts"]);
    insertCapsuleLog("s1", "database pool", 4000, 3100, ["getConnection", "Pool"], ["src/db.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.capsulesGenerated).toBe(2);
    expect(stats.totalTokensBudgeted).toBe(8000);
    expect(stats.totalTokensUsed).toBe(5500);
    expect(stats.uniqueFiles).toBe(3);
    expect(stats.uniqueSymbols).toBe(4);
  });

  it("calculates estimated savings", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "auth", 4000, 2000, ["fn1"], ["src/a.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.estimatedRawTokens).toBeGreaterThan(stats.totalTokensUsed);
    expect(stats.estimatedSavingsPercent).toBeGreaterThan(0);
  });

  it("deduplicates files and symbols across capsules", () => {
    setupSession("s1");
    insertCapsuleLog("s1", "query1", 4000, 2000, ["fn1", "fn2"], ["src/a.ts"]);
    insertCapsuleLog("s1", "query2", 4000, 2000, ["fn2", "fn3"], ["src/a.ts", "src/b.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.uniqueFiles).toBe(2);
    expect(stats.uniqueSymbols).toBe(3);
  });

  it("only counts capsules for the specified session", () => {
    setupSession("s1");
    setupSession("s2");
    insertCapsuleLog("s1", "auth", 4000, 2000, ["fn1"], ["src/a.ts"]);
    insertCapsuleLog("s2", "db", 4000, 3000, ["fn2"], ["src/b.ts"]);

    const stats = computeSessionStats(db, "s1", "/test");
    expect(stats.capsulesGenerated).toBe(1);
    expect(stats.totalTokensUsed).toBe(2000);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stats.test.ts`
Expected: FAIL — cannot resolve `../../src/mcp/tools/stats.js` or `computeSessionStats` not exported

**Step 3: Commit**

```bash
git add tests/unit/stats.test.ts
git commit -m "test(stats): add session stats aggregation tests"
```

---

### Task 10: Session Stats Tool — Implementation

**Files:**
- Create: `src/mcp/tools/stats.ts`

**Step 1: Implement the stats tool**

```ts
import { z } from "zod/v3";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { capsuleLogQueries } from "../../db/queries/capsule-log.js";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const AVG_FILE_TOKENS_FALLBACK = 3000;
const BYTES_PER_TOKEN_ESTIMATE = 4;

export interface SessionStats {
  capsulesGenerated: number;
  totalTokensBudgeted: number;
  totalTokensUsed: number;
  uniqueFiles: number;
  uniqueSymbols: number;
  estimatedRawTokens: number;
  estimatedSavingsPercent: number;
}

export function computeSessionStats(
  db: Database.Database,
  sessionId: string,
  projectRoot: string
): SessionStats {
  const logs = capsuleLogQueries(db).getBySession(sessionId);

  if (logs.length === 0) {
    return {
      capsulesGenerated: 0,
      totalTokensBudgeted: 0,
      totalTokensUsed: 0,
      uniqueFiles: 0,
      uniqueSymbols: 0,
      estimatedRawTokens: 0,
      estimatedSavingsPercent: 0,
    };
  }

  let totalBudgeted = 0;
  let totalUsed = 0;
  const allFiles = new Set<string>();
  const allSymbols = new Set<string>();

  for (const log of logs) {
    totalBudgeted += log.tokenBudget;
    totalUsed += log.tokensUsed;
    for (const f of log.filesIncluded) allFiles.add(f);
    for (const s of log.symbolsIncluded) allSymbols.add(s);
  }

  let estimatedRawTokens = 0;
  for (const filePath of allFiles) {
    try {
      const fullPath = resolve(projectRoot, filePath);
      const size = statSync(fullPath).size;
      estimatedRawTokens += Math.ceil(size / BYTES_PER_TOKEN_ESTIMATE);
    } catch {
      estimatedRawTokens += AVG_FILE_TOKENS_FALLBACK;
    }
  }

  estimatedRawTokens = Math.max(estimatedRawTokens, totalUsed);

  const savings =
    estimatedRawTokens > 0
      ? Math.round(((estimatedRawTokens - totalUsed) / estimatedRawTokens) * 100)
      : 0;

  return {
    capsulesGenerated: logs.length,
    totalTokensBudgeted: totalBudgeted,
    totalTokensUsed: totalUsed,
    uniqueFiles: allFiles.size,
    uniqueSymbols: allSymbols.size,
    estimatedRawTokens,
    estimatedSavingsPercent: Math.max(0, savings),
  };
}

function formatStats(stats: SessionStats, sessionId: string): string {
  const lines = [
    "ContextWeave Session Stats",
    `Session: ${sessionId}`,
    "",
    `Capsules generated:    ${stats.capsulesGenerated}`,
    `Total tokens budgeted: ${stats.totalTokensBudgeted.toLocaleString()}`,
    `Total tokens used:     ${stats.totalTokensUsed.toLocaleString()} (${stats.totalTokensBudgeted > 0 ? Math.round((stats.totalTokensUsed / stats.totalTokensBudgeted) * 100) : 0}% of budget)`,
    `Unique files covered:  ${stats.uniqueFiles}`,
    `Unique symbols served: ${stats.uniqueSymbols}`,
  ];

  if (stats.capsulesGenerated > 0) {
    lines.push(
      "",
      "Estimated savings:",
      `  Raw file reads (est): ~${stats.estimatedRawTokens.toLocaleString()} tokens`,
      `  ContextWeave used:    ~${stats.totalTokensUsed.toLocaleString()} tokens`,
      `  Estimated savings:    ~${(stats.estimatedRawTokens - stats.totalTokensUsed).toLocaleString()} tokens (${stats.estimatedSavingsPercent}% reduction)`
    );
  }

  return lines.join("\n");
}

export function registerStatsTool(
  server: McpServer,
  db: Database.Database,
  projectRoot: string,
  serverSessionId: string
): void {
  const registerTool = (server.tool as (...args: any[]) => void).bind(server);

  registerTool(
    "cw_stats",
    "Show session context savings: capsules generated, tokens used vs estimated raw reads, files and symbols covered.",
    {
      session_id: z
        .string()
        .optional()
        .describe("Session ID to query (default: current session)"),
    },
    async ({ session_id }: { session_id?: string }) => {
      try {
        const targetSession = session_id ?? serverSessionId;
        const stats = computeSessionStats(db, targetSession, projectRoot);
        const text = formatStats(stats, targetSession);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Stats failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
```

**Step 2: Run the tests**

Run: `npx vitest run tests/unit/stats.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/mcp/tools/stats.ts
git commit -m "feat(stats): add cw_stats session stats tool with savings estimation"
```

---

### Task 11: Register Stats Tool in MCP Server

**Files:**
- Modify: `src/mcp/server.ts:1-22` (imports) and `src/mcp/server.ts:49-57` (registration block)

**Step 1: Add import**

After line 17 (`import { registerReadTool } ...`), add:
```ts
import { registerStatsTool } from "./tools/stats.js";
```

**Step 2: Add registration call**

After line 57 (`registerReadTool(server, db, projectRoot);`), add:
```ts
  registerStatsTool(server, db, projectRoot, serverSessionId);
```

This registers the stats tool for both primary and secondary sessions (it's read-only).

**Step 3: Run a quick type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat(stats): register cw_stats tool in MCP server"
```

---

### Task 12: Full Regression Run

**Files:** None (testing only)

**Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: ALL PASS. No regressions.

**Step 2: If any tests fail, fix them**

Common reasons for failure:
- **bm25-correctness.test.ts** — if a test checks raw stored terms (e.g., `"hello"`), stemming may change them. `stem("hello") === "hello"` so this should be fine. But `stem("consistent") === "consist"` — if any test checks for `"consistent"` as a stored term, update it to `"consist"`.
- **passive-observation-recall.test.ts** — uses BM25 via ObservationStore, which now calls `searchWithFallback`. Should still work since it falls through to same results on exact matches.

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust test assertions for stemmed BM25 tokens"
```

(Only if there were fixes needed. Skip this commit if everything passed.)

---

### Task 13: Final Commit and Push

**Files:** None

**Step 1: Verify clean state**

Run: `git status`
Expected: Clean working tree, all changes committed.

**Step 2: Review commit history**

Run: `git log --oneline -10`
Expected: See all the task commits in order.

**Step 3: Push to main**

Run: `git push origin main`
Expected: Success

---

## Summary of All Changes

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/stemmer.ts` | CREATE | Porter Stemmer (5-step algorithm) |
| `src/utils/levenshtein.ts` | CREATE | Levenshtein distance + term correction |
| `src/memory/bm25.ts` | MODIFY | Stemmed tokenize, `searchWithFallback()`, `getDistinctTerms()`, `reindexAll()` |
| `src/memory/observations.ts` | MODIFY | Wire `searchWithFallback()` into both search methods |
| `src/db/migrations.ts` | MODIFY | Migration v7: re-index BM25 with stemming |
| `src/mcp/tools/stats.ts` | CREATE | `cw_stats` MCP tool with savings estimation |
| `src/mcp/server.ts` | MODIFY | Import + register `registerStatsTool` |
| `tests/unit/stemmer.test.ts` | CREATE | Porter Stemmer unit tests |
| `tests/unit/levenshtein.test.ts` | CREATE | Levenshtein distance unit tests |
| `tests/unit/bm25.test.ts` | MODIFY | Stemmed search + fallback tests |
| `tests/unit/stats.test.ts` | CREATE | Session stats aggregation tests |
