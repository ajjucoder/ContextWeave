# Five Retrieval Gaps — Design Document

Date: 2026-03-09
Status: Approved (self-approved, user said "do what you think is best")

## Overview

Five remaining retrieval quality gaps identified across Sitecraft, Claud-ometer, and production reviews. Ordered by dependency: Gaps 1 & 3 are independent, Gap 2 is foundation, Gaps 4 & 5 depend on Gap 2.

## Gap 1: cw_grep Regex Normalization (Tier 1)

**Problem:** `/pattern/` syntax behaves differently in ripgrep vs JS fallback. `{}` brace expansion silently fails.

**Solution:**
- Normalize `/pattern/flags` consistently: extract flags, map `i` → case-insensitive on both paths, ignore `g` (ripgrep is always global), map `m` → multiline
- Detect `{foo,bar}` brace expansion in search patterns → throw clear error suggesting `(foo|bar)`
- Unmatched single `{` or `}` passes through (common in code searches like `interface{}`)

**Files:** `src/mcp/tools/search.ts`, `src/mcp/tools/ripgrep.ts`

## Gap 2: Repo-Shape Profiling (Tier 2)

**Problem:** No detection of "this is a Next.js project" vs "this is a Spring backend". Directory weights are static.

**Solution:**
- New `src/core/repo-profiler.ts` — detect project type from marker files
- `RepoProfile`: projectType[], framework[], backendRoot[], frontendRoot[], layers[]
- `RetrievalLane`: named search scope tied to a layer with path prefixes and priority
- Lanes bias capsule scoring for broad queries
- Profile persisted in `repo_profile` table, refreshed on reindex
- Dynamic directory weight adjustment based on profile

**Marker detection:** next.config → Next.js, angular.json → Angular, Cargo.toml → Rust, go.mod → Go, pom.xml → Spring, package.json deps for Express/Fastify/NestJS, etc.

**ArchLayer enum:** storage, server, api-route, client-fetch, state, ui-component, config

## Gap 3: Better Clustering (Tier 2)

**Problem:** Clustering only uses `import` edges. Call and type reference edges are ignored.

**Solution:**
- Add to union-find: `call` (>= 2 cross-file edges), `type_usage` (>= 3), `inheritance`/`implements` (always)
- Increase MAX_CLUSTER_SIZE from 20 to 30
- Keep `reference` edges out (too noisy)

**Files:** `src/core/clusters.ts`

## Gap 4: Mandatory Chain Coverage (Tier 2)

**Problem:** Broad queries should cover all layers (storage → server → client → UI). Graph expansion helps but doesn't enforce.

**Solution:**
- Post-BFS layer coverage check using repo profile's ArchLayer definitions
- Missing layers get targeted fill search (up to 3 symbols per missing layer)
- Only for broad/task intents
- Coverage metadata in capsule output

**Depends on:** Gap 2

**Files:** New `src/capsule/chain-coverage.ts`, `src/capsule/generator.ts`

## Gap 5: Convention Graph (Tier 3)

**Problem:** No architectural-concept graph above the symbol graph.

**Solution:**
- Convention = named architectural concept with file membership
- Detected from: repo profile layers, pattern detector groups, naming conventions (*.controller.*, *.service.*, *.hook.*, etc.), export analysis (barrel files)
- Convention edges derived from aggregate symbol edges between convention groups
- Used for convention diversity scoring in broad queries
- DB tables: `conventions`, `convention_files`
- Exposed via `cw_overview`

**Depends on:** Gap 2

## Execution Order

```
Parallel Track A: Gap 1 (grep regex) → tests
Parallel Track B: Gap 3 (clustering) → tests
Sequential:       Gap 2 (repo profiler + lanes) → Gap 4 (chain coverage) → Gap 5 (convention graph)
Final:            Integration wiring + regression check
```

## Graceful Degradation

All features degrade when prerequisites are absent:
- No ripgrep → fallback scanner with normalized regex
- No profile → no lanes, no chain coverage, conventions from naming only
- No conventions → basic capsule still works
- Empty project → no clusters, no profile, basic capsule works
