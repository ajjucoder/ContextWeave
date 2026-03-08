# Augment vs ContextWeave — Deep Research

What Augment actually does under the hood, what ContextWeave already has, what's missing, and how to close the gap. Written in plain language.

---

## Table of Contents

- [How Augment Works (Reverse-Engineered)](#how-augment-works)
  - [1. Semantic Code Embeddings](#1-semantic-code-embeddings)
  - [2. AST-Aware Code Chunking](#2-ast-aware-code-chunking)
  - [3. Hybrid Search with Rank Fusion](#3-hybrid-search-with-rank-fusion)
  - [4. Knowledge Graph](#4-knowledge-graph)
  - [5. Incremental Indexing](#5-incremental-indexing)
- [How Cursor Works (For Comparison)](#how-cursor-works)
- [Open-Source Tools Doing Similar Things](#open-source-tools-doing-similar-things)
- [What ContextWeave Already Has](#what-contextweave-already-has)
- [The Gap: Side-by-Side Comparison](#the-gap)
- [The Real Token Savings Math](#the-real-token-savings-math)
- [Can ContextWeave Replace Grep + Explorer?](#can-contextweave-replace-grep--explorer)
- [Sources](#sources)

---

## How Augment Works

Augment keeps their exact code proprietary, but their blog posts, SDK docs, co-founder interviews, and public architecture descriptions reveal five systems working together. None of it is magic — it's well-known information retrieval techniques applied specifically to code.

### 1. Semantic Code Embeddings

**What it is:** Converting code into numbers (vectors) that capture meaning, not just keywords.

**Why it matters:** When you search "authentication logic," BM25 (keyword search) only finds files containing the word "authentication." Embeddings understand that `verifyCredentials()` and `middleware/proxy.ts` are about authentication even without that exact word.

**How Augment does it:**
- Code gets split into meaningful chunks (functions, classes — not random lines)
- Each chunk gets converted into a vector (a list of ~384-1536 numbers) by an embedding model
- These vectors get stored in a database
- At search time, your question also becomes a vector, and the system finds chunks whose vectors are closest to your question's vector
- This is called "vector similarity search" or "semantic search"

**Their performance numbers (from their blog):**
- ~20 bytes per line of code to store embeddings
- ~20 nanoseconds per line of code to search
- For 100M+ line codebases: they use "quantized" vectors (compressed from full precision to smaller bit representations)
- Quantization reduces memory 8x (2GB down to 250MB for 100M LOC)
- Search drops from 2+ seconds to under 200ms
- 99.9% accuracy maintained despite compression

**What ContextWeave has:** Nothing. BM25 only, plus a hand-coded 14-entry synonym map. This is the single biggest gap.

**What we'd use to replicate it:**
- Embedding model: `all-MiniLM-L6-v2` — 384 dimensions, runs locally via ONNX runtime, no API keys needed, <50ms per chunk. This is what codemogger (an open-source tool doing similar things) uses.
- Alternatives: `nomic-embed-text` (better quality, still local), `jina-embeddings-v3` (multilingual)
- Vector storage: `sqlite-vec` extension — stores vectors in the same SQLite database ContextWeave already uses. No separate server needed.
- Quantization: Int8 reduces storage from 1,536 bytes to 395 bytes per chunk with minimal quality loss

### 2. AST-Aware Code Chunking

**What it is:** Splitting code into pieces intelligently — at function/class boundaries, not arbitrary line counts.

**Why it matters:** If you split a 200-line file into 4 chunks of 50 lines each, you might cut a function in half. The embedding for that half-function is meaningless. If you split at semantic boundaries (where functions start and end), each chunk is a complete meaningful unit.

**How Augment does it:**
- Parse code with tree-sitter into an Abstract Syntax Tree (AST)
- Identify semantic entities: functions, methods, classes, interfaces, imports
- Split at those boundaries — never mid-function
- Each chunk gets "contextualized" with extra metadata:
  - **Scope chain:** "This function lives inside UserService class"
  - **Imports:** "This code uses express, supabase-js"
  - **Siblings:** "Adjacent functions are getUser() and deleteUser()"
  - **Signatures:** Type signatures of related code

This metadata gets prepended to the code before embedding. So the embedding model doesn't just see raw code — it understands the code's context in the project.

**What ContextWeave has:** Steps 1-2 exist (tree-sitter parsing + symbol extraction). What's missing: steps 3-5 (building enriched, embeddable chunks with context metadata). Currently ContextWeave extracts symbol skeletons for BM25 — not contextualized chunks optimized for embedding.

**Open-source reference implementations:**
- `code-chunk` library (supermemoryai): 5-stage pipeline — Parse → Extract → Build Scope Tree → Chunk → Enrich. Supports TS, JS, Python, Rust, Go, Java. Default chunk size: 1500 bytes. Merges small chunks, never splits mid-expression.
- `codemogger`: Extracts top-level definitions. Items >150 lines get subdivided. 13 language grammars.

### 3. Hybrid Search with Rank Fusion

**What it is:** Using BOTH keyword search and vector search together, then merging the results.

**Why it matters:**
- Keyword search (BM25) is great for exact identifiers: searching `getUserName` finds `getUserName`
- Vector search is great for meaning: searching "authentication logic" finds `verifyCredentials()`
- Neither alone is enough. Together they cover both cases.

**How it works (industry standard, used by Augment, Cursor, and production RAG systems):**

```
User query: "how does auth connect to the dashboard"
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   BM25 Search              Vector Search
   (keyword match)          (meaning match)
        │                       │
   Ranked List A            Ranked List B
   1. auth.ts               1. middleware/proxy.ts
   2. AuthProvider.tsx       2. useSession.ts
   3. dashboard/page.tsx     3. AuthProvider.tsx
        │                       │
        └───────────┬───────────┘
                    ▼
         Reciprocal Rank Fusion (RRF)
         score(file) = 1/(60 + rankA) + 1/(60 + rankB)
                    │
                    ▼
         Final Merged List
         1. AuthProvider.tsx (appeared in both)
         2. middleware/proxy.ts (high semantic match)
         3. auth.ts (high keyword match)
         4. dashboard/page.tsx
```

The formula `1/(k + rank)` (where k=60 is standard) gives higher scores to items ranked highly in either list, with bonus for appearing in both.

**What ContextWeave has:** BM25 only. The `semantic-reranker.ts` is a tiny hard-coded concept map (14 synonym pairs) plus token overlap. It's not semantic search — it's keyword expansion. This is why `cw_grep` (pure BM25) outperforms `cw_capsule` (which pretends to be semantic but isn't).

### 4. Knowledge Graph

**What it is:** A map of how code connects — not just imports, but types, calls, data flow, and patterns.

**Augment's marketing says:** "Real-time knowledge graph, 1M+ files indexed." From the technical details, this means:
- **Import edges:** File A imports from File B (ContextWeave has this)
- **Call edges:** Function A calls Function B (ContextWeave has this partially)
- **Type edges:** Class A implements Interface B, Type A extends Type B (ContextWeave doesn't have this)
- **Activity weighting:** Recently modified code ranks higher (ContextWeave doesn't do this)
- **Graph expansion:** After finding initial search results, walk the graph to find related code the search might have missed

The "knowledge graph" isn't a separate fancy database. It's the symbol dependency graph enriched with more edge types, stored alongside everything else. The key insight: **vector search finds the starting points, then graph traversal finds the connected context.**

**What ContextWeave has:** ~60% of this. The symbol graph with import/call edges exists. PageRank scoring exists. What's missing: type relationship edges, recency weighting, and using the graph to expand search results after the initial vector search.

### 5. Incremental Indexing

**What it is:** Only re-processing files that changed, not re-indexing everything every time.

**How Augment does it:**
- SHA-256 hash per file stored in the index
- On re-scan, compare hashes — only re-embed files with different hashes
- Deleted files get removed from the index
- New files get added
- The index stays fresh without re-doing all the work

**How Cursor does it (different approach, same goal):**
- Merkle tree: every file is a leaf hash, every directory is the hash of its children
- Change detection in O(k log n) time, where k = number of changed files
- Extremely fast for large repos

**What ContextWeave has:** File hashing already exists in the indexer. What's missing: a file watcher (fs.watch or chokidar) for automatic re-indexing when files change, and incremental embedding updates (only re-embed changed chunks, not all chunks in changed files).

---

## How Cursor Works (For Comparison)

Cursor's approach is well-documented and gives another reference point:

- **Indexing:** Chunks codebase into pieces, embeds each chunk, stores in a vector database
- **Change detection:** Merkle trees — hash-based tree structure for O(k log n) diff detection
- **Retrieval:** Semantic search (vector similarity) to find relevant code for any query
- **Context building:** Retrieved chunks get assembled into context for the LLM
- **Tab completion:** Uses Fill-In-the-Middle (FIM) with limited context (current file + open tabs)
- **Chat/Agent:** Uses the full RAG pipeline — semantic search across the entire indexed codebase

Key difference from Augment: Cursor runs embeddings locally or on their cloud. Augment runs everything on their cloud. Both use the same fundamental approach: chunk → embed → vector search → rank → pack into context.

---

## Open-Source Tools Doing Similar Things

These prove the approach is replicable without Augment's budget:

### codemogger (TypeScript, MIT license)
- tree-sitter WASM for parsing (13 languages)
- `all-MiniLM-L6-v2` embeddings (384-dim, int8 quantized, local)
- Single SQLite file per codebase with FTS + vector index
- Hybrid search: vector cosine similarity + FTS weighted fields
- Keyword search 25x-370x faster than ripgrep
- Incremental updates via SHA-256 hashing
- MCP server with `search`, `index`, `reindex` tools
- **This is the closest to what ContextWeave should become**

### code-chunk (supermemoryai)
- AST-aware chunking library
- 5-stage pipeline: Parse → Extract → Build Scope Tree → Chunk → Enrich
- Each chunk gets scope chain, imports, siblings, entity signatures
- Default 1500 bytes per chunk, 10-line overlap
- Never splits mid-function or mid-expression
- Supports TS, JS, Python, Rust, Go, Java

### retriv (TypeScript, MIT license)
- Hybrid BM25 + vector search with RRF fusion
- AST-aware chunking via TypeScript compiler API
- Automatic camelCase/snake_case tokenization
- Local-first with SQLite, optional cloud backends
- Purpose-built for JS/TS ecosystem

### jCodeMunch (Python, 566 stars)
- tree-sitter AST parsing for token-efficient symbol extraction
- Claims 99% token cost reduction vs reading full files
- MCP server for AI coding agents
- Structured retrieval: functions, classes, methods, constants
- Byte-level precision extraction

### CocoIndex (Python)
- Real-time codebase indexing with tree-sitter
- Incremental processing (only reprocess what changed)
- Vector embeddings for semantic search
- Designed for coding agents, code review agents, MCP servers

---

## What ContextWeave Already Has

This is important — ContextWeave isn't starting from zero. Here's what exists:

| Component | Status | Quality |
|-----------|--------|---------|
| tree-sitter AST parsing | Done | Good — 12 languages |
| Symbol extraction | Done | Good — functions, classes, methods, interfaces |
| Symbol dependency graph | Done | Good — import + call edges, PageRank |
| Impact analysis (cw_impact) | Done | Good — depth-2 BFS, accurate dependents |
| BM25 text search (FTS5) | Done | Good — with trigram + Levenshtein fallback |
| Token-budgeted packing | Done | Needs fixes — underutilizes budget |
| Cross-session memory | Done | Needs work — stores doc quotes, not patterns |
| MCP server (stdio) | Done | Good — 12 tools, stable |
| SQLite storage | Done | Good — per-project .db file |
| Local-first architecture | Done | Advantage over Augment (no cloud needed) |
| CSR PageRank | Done | Good — 1M symbols in 556ms |
| File hashing | Done | Good — change detection exists |

**Honest assessment: ~60% of Augment's architecture already exists.**

---

## The Gap

### Side-by-Side Comparison

| Capability | Augment | ContextWeave Today | Gap Size |
|-----------|---------|-------------------|----------|
| AST parsing (multi-language) | tree-sitter, cloud | tree-sitter, local | None |
| Symbol dependency graph | Knowledge graph | SQLite edges + PageRank | Small |
| Impact analysis | Dependency tracing | Depth-2 BFS | Small |
| Token-budgeted packing | Token budgeting | 7-phase pipeline | None |
| Cross-session memory | Persistent context | Observations + staleness | Small |
| MCP server | MCP + IDE + CLI | MCP stdio, 12 tools | None |
| Local-first, no cloud | No (cloud required) | Yes | CW is ahead |
| **Semantic embeddings** | Core of their system | **None** | **Large** |
| **Quantized vector search** | ANN + bit quantization | **None** | **Large** |
| **AST-aware chunking for embedding** | Contextualized chunks | Symbol skeletons only | **Medium** |
| **Hybrid search (BM25 + vector)** | RRF fusion | BM25 only | **Medium** |
| **Recency weighting** | Activity-weighted ranking | None | Small |
| **Pattern detection** | Convention learning | None | Medium |
| **Structured JSON API output** | Structured + text | Text only | Small |
| **File watcher** | Auto re-index on change | Manual reindex only | Small |
| **Confidence calibration** | Trustworthy scores | Over-reports HIGH | Medium |

### What the gap really means

The four things ContextWeave is missing that Augment has:

1. **Embeddings** — the ability to understand meaning, not just match keywords
2. **Hybrid search** — combining keyword precision with semantic recall
3. **Enriched chunking** — giving the embedding model context about each code piece
4. **Honest confidence** — knowing when retrieval is incomplete and saying so

Everything else is either already built or a small extension of what exists.

---

## The Real Token Savings Math

The reviews found ContextWeave's "97% savings" claim was inflated. Here's the honest comparison:

### Without ContextWeave (agent uses Grep + Read)
```
Agent greps for symbol:           ~200 tokens
Agent reads file 1:              ~3,000 tokens
Agent greps again for related:    ~200 tokens
Agent reads file 2:              ~3,000 tokens
Agent reads file 3:              ~3,000 tokens
Total:                           ~9,400 tokens
```

### With ContextWeave today (broken retrieval)
```
cw_capsule call:                  ~500 tokens (poor quality, doesn't fill budget)
Agent doesn't trust it, greps:    ~200 tokens
Agent reads 3 files anyway:      ~9,000 tokens
Total:                           ~9,700 tokens (WORSE — capsule was wasted)
```

### With ContextWeave after fixes (hybrid search, filled budget)
```
cw_capsule call:                  ~3,500 tokens (good quality, fills budget)
Agent does 1 follow-up read:     ~1,500 tokens
Total:                           ~5,000 tokens
Real savings:                    ~47%
```

### With full implementation (embeddings + patterns + graph expansion)
```
cw_capsule call:                  ~3,800 tokens (excellent quality)
Agent proceeds directly:              ~0 follow-up reads
Total:                           ~3,800 tokens
Real savings:                    ~60-70%
```

**Honest conclusion:** 60-70% real savings is achievable and genuinely valuable. 97% was never real.

---

## Can ContextWeave Replace Grep + Explorer?

### What Grep + Explorer costs
The Explorer Agent in Claude Code typically costs 20,000-50,000 tokens per exploration. It does: grep → read → grep → read → think → grep → read. It's expensive because it's blind — it searches iteratively until it finds what it needs.

### What a fixed ContextWeave would cost
One `cw_capsule` call: 3,000-5,000 tokens. One call instead of 10-15 tool calls.

### When ContextWeave can replace them (after full implementation)
- Narrow symbol lookups: "find useDataLayer and its consumers" — yes
- Broad architecture questions: "how does auth connect to dashboard" — yes, with embeddings
- Impact analysis: "what breaks if I change this function" — yes, already works
- Pattern questions: "what convention do dashboard pages follow" — yes, with pattern detection

### When you'd still need Grep/Explorer
- Code just written in the current session (not yet indexed)
- Very specific regex patterns across files
- Cross-repo questions (unless multiple repos are indexed)
- Debugging runtime behavior (logs, stack traces)

### The bar from the reviews
Every reviewer set this test: "On the first broad query, does it land on the right files without manual hints?" Current ContextWeave fails this test. With hybrid search (BM25 + embeddings), it would pass it.

---

## Sources

### Augment Official
- [Context Engine MCP Launch](https://www.augmentcode.com/blog/context-engine-mcp-now-live) — Feb 2026
- [Context Engine Product Page](https://www.augmentcode.com/context-engine)
- [Quantized Vector Search Blog](https://augmentcode.com/blog/repo-scale-100M-line-codebase-quantized-vector-search) — Jun 2025
- [Context Connectors Architecture](https://docs.augmentcode.com/context-services/context-connectors/how-it-works)
- [SDK API Reference](https://docs.augmentcode.com/context-services/sdk/api-reference)
- [Agentic Retrieval Techniques](https://www.augmentcode.com/guides/agentic-retrieval-techniques-for-complex-codebases) — Aug 2025
- [Deep Code Understanding](https://www.augmentcode.com/learn/context-ai-deep-code-understanding) — Aug 2025
- [Context Engineering Guide](https://www.augmentcode.com/guides/mastering-context-engineering-for-ai-driven-development) — Aug 2025
- [Deep Context Threading](https://www.augmentcode.com/guides/deep-context-threading-for-enterprise-codebases) — Aug 2025

### Augment Interviews
- [Cognitive Revolution Podcast — Guy Gur-Ari (Co-Founder)](https://www.cognitiverevolution.ai/code-context-is-king-augments-ai-assistant-for-professional-software-engineers-with-guy-gur-ari/) — Mar 2025
- [Cerebral Valley — Guy Gur-Ari Interview](https://cerebralvalley.beehiiv.com/p/augment-code-is-your-ai-coding-agent-for-real-world-codebases) — Dec 2025

### Cursor Architecture
- [How Cursor Actually Indexes Your Codebase](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/) — Jan 2026
- [How Cursor Indexes Codebases Fast (Merkle Trees)](https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast) — May 2025
- [Rebuilt Cursor's Merkle Tree in 200 Lines](https://medium.com/@thinkingthroughcode/i-rebuilt-cursors-merkle-tree-index-in-200-lines-of-typescript-c9f821ea90cd) — Mar 2026
- [How Cursor Works Internally](https://adityarohilla.com/2025/05/08/how-cursor-works-internally/) — May 2025
- [The Magic Behind AI IDEs](https://pinishv.com/articles/the-magic-behind-ai-ides-how-cursor-windsurf-and-friends-actually-work/) — Sep 2025

### Open-Source Implementations
- [codemogger](https://github.com/glommer/codemogger) — tree-sitter + embeddings + SQLite + MCP (191 stars, MIT)
- [code-chunk](https://github.com/supermemoryai/code-chunk) — AST-aware chunking library (152 stars)
- [retriv](https://github.com/harlan-zw/retriv) — Hybrid BM25 + vector search for TS/JS (22 stars, MIT)
- [jCodeMunch](https://github.com/jgravelle/jcodemunch-mcp) — token-efficient MCP server (566 stars)
- [CocoIndex Realtime Codebase Indexing](https://github.com/cocoindex-io/realtime-codebase-indexing) — tree-sitter + vector embeddings
- [Code Context MCP](https://www.pulsemcp.com/servers/code-context) — semantic code search MCP server
- [Code Sage MCP](https://www.pulsemcp.com/servers/faxioman-code-sage) — BM25 + vector + RRF + AST chunking

### Research Papers
- [ARCS: Agentic Retrieval-Augmented Code Synthesis](https://openreview.net/pdf?id=qrfgXhZcG7) — ICLR 2026 submission
- [Context-Augmented Code Generation Using Programming Knowledge Graphs](https://www.researchgate.net/publication/400179073) — Jan 2026
- [LAURA: Context-Enriched Retrieval-Augmented Code Review](https://arxiv.org/html/2512.01356v2)

### Industry Articles
- [Building Open-Source Alternative to Cursor](https://milvus.io/blog/build-open-source-alternative-to-cursor-with-code-context.md) — Milvus, Jul 2025
- [Building a Graph-Augmented RAG System for Code Intelligence](https://medium.com/@muhammadalinasir00786/building-a-graph-augmented-rag-system-for-code-intelligence-lessons-from-codegraph-cli-21da25553ee7) — Feb 2026
- [Building an AI Codebase Analyzer (RAG + FAISS)](https://medium.com/@yadunandanmn/building-an-ai-codebase-analyzer-what-i-learned-about-rag-faiss-and-code-understanding-433ff4b1de8e) — Mar 2026
- [Augment Code Makes Semantic Coding Available for Any Agent](https://siliconangle.com/2026/02/06/augment-code-makes-semantic-coding-capability-available-ai-agent/) — SiliconANGLE, Feb 2026
