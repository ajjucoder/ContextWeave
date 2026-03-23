# ContextWeave Field Review: KisanSathi

**Date:** 2026-03-14
**ContextWeave Version:** `contextweave v0.1.0`

## Project Profile

| Metric | Value |
|--------|-------|
| Project | KisanSathi |
| Stack | Spring Boot 3.5.3, Java 17/21, MongoDB, Elasticsearch, static HTML/JS frontend |
| Lines of Code | 213,227 |
| Source Files | 1,110 detected by extension scan / 444 indexed by ContextWeave |
| Symbols Indexed | 2,773 |
| Languages | JavaScript, Java, JSON, Markdown, PHP, YAML |
| Index Time | `cw reindex` refresh took 4.08s on 2026-03-14; output was misleading (`444 files, 0 symbols`) because all files were skipped as unchanged |
| Architecture | Spring monolith with REST controllers, `*Model` service layer, Mongo + Elasticsearch dual persistence, heavy vendored static frontend assets |
| Key Directories | `src/main/java/com/example/KisanSathi/{Authentication,Admin,Shop,User,OTP,Files,Location}`, `src/main/resources/static/{vegefoods-master,Frontend}` |

## Task-Based Results

### Task A: Find and understand `validateOTP` and where signup/order flows rely on it

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 3,363 | 823 |
| Tool calls | 6 | 4 |
| Completeness | Complete | Complete |
| Time to correct answer | Slower | Faster |

**What ContextWeave found:** The exact definition, the `saveOTP` lifecycle helper, and eventually the two real callers via `cw_grep`.

**What ContextWeave missed:** The capsule itself did not surface the signup caller or checkout caller, and both `cw_flow` and `cw_impact` falsely claimed there were no flows/dependents. The initial answer was not usable without falling back to exact search.

**Follow-up suggestions useful?** Partial. The suggested `cw_read` target was right, but the suggestion syntax was wrong: it emitted `cw_read(file: ...)` even though the tool actually expects `path`.

**Winner:** Grep+Read

### Task B: Trace cart checkout -> OTP -> order placement flow from frontend to persistence

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 5,155 | 1,687 |
| Tool calls | 9 | 7 |
| Completeness | Complete | Complete |
| Time to correct answer | Slower | Faster |

**What ContextWeave found:** The capsule did at least pull in both backend controllers and the cart page JS. `cw_grep` was useful for exact HTTP endpoint jumps like `generateOrderOtp`, `/User/order`, and `createOrder`.

**What ContextWeave missed:** The capsule missed the OTP-generation step and did not give the actual `OrderModel.createOrder` body. `cw_flow` failed both on the frontend HTTP edge and on file-qualified backend targets, so the “flow” tool did not help on the actual flow task.

**Follow-up suggestions useful?** Mostly no. The capsule suggested reading `CartController` and `OrderModel`, but not the actual frontend `checkout.js` function that makes `/User/order`, which was essential to answer the flow correctly.

**Winner:** Grep+Read

### Task C: Answer the architectural question “How are Product and Order writes handled across MongoDB and Elasticsearch?”

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 6,489 | 2,307 |
| Tool calls | 8 | 4 |
| Completeness | Complete | Complete |
| Time to correct answer | Much slower | Faster |

**What ContextWeave found:** Exact grep-like probes for `productESRepository.save` and `elasticOrderRepo.save` did recover the two core write sites. Bounded reads of `OrderModel` and the correct `ProductModel` file eventually made the design answerable.

**What ContextWeave missed:** The initial capsule was badly wrong. It prioritized `Order`/`Product` entity annotations, unrelated controller reads, and vendored frontend noise instead of the actual dual-write service methods. `cw_read` also misresolved `ProductModel` to the wrong class when asked for the admin `ProductModel` symbol.

**Follow-up suggestions useful?** No. The suggested follow-ups kept pushing entity reads, not the service-layer write paths where the real consistency behavior lives.

**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 15,007
- Total Grep+Read tokens across 3 tasks: 4,817
- Actual savings: `-211.5%` (ContextWeave used ~3.1x more tokens)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `validateOTP` | Yes | — |
| `createOrder` | Yes | — |
| `ProductModel` | No | `Admin/Products/Controller/ProductController.productModel` field injection and other usages beat the definition |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `error handling across the app` | MEDIUM | 1331/2000 | No — results were dominated by vendored JS plus one `CustomErrorController`; this is not app-wide error handling |
| `state management` | HIGH | 1593/2000 | No — this was obvious nonsense from `states` arrays and permissions JSON, yet it got `HIGH` + `VERY_LOW` uncertainty |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| `cart checkout to order placement flow` | 8000 | 568 | 7.1% |
| `How are Product and Order entities written to both MongoDB and Elasticsearch?` | 8000 | 911 | 11.4% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `createOrder` | No | N/A | `cw_flow` reported no outgoing flows despite obvious calls to `userRepo`, `cartRepo`, `emailSender`, `elasticOrderRepo`, and `orderRepo` |
| `resources/static/.../cart.js:checkout` | N/A | No | `cw_flow` could not trace the `/User/checkout` HTTP boundary at all |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `checkout flow` | 6 | Helpful at project root, but path-scoped overview with `java/com/example/KisanSathi` returned `No indexed files found for this scope` because path normalization is inconsistent |
| `cw_recall` | `architecture` | 2 | Returned junk from the earlier bad `state management` capsule instead of durable architecture knowledge |
| `cw_impact` | `createOrder` | 1 | Missed the obvious dependent `CheckoutController.checkout` |
| `cw_stats` | `session_id = taskB2-cw` | 4 | Honest about severe underutilization, but misleadingly reported `First-pass rate 100%` and `Avg follow-up reads 0.00` even though the answer required many follow-ups |

## Flaws Found

Ordered by severity. Each flaw includes what happened, likely root cause, and what to fix.

### P0 (Critical — blocks adoption)
1. **Broad retrieval gets hijacked by vendored frontend assets**: Architectural queries like `How are MongoDB and Elasticsearch dual writes handled across the app?` and `error handling across the app` were flooded by `modernizr.js`, `plugins.js`, `aos.js`, and form-validation bundles instead of service-layer Java.  
   Root cause: ranking and directory weighting are not aggressively down-weighting vendored/static assets on mixed repos; likely in `src/capsule/generator.ts`, `src/capsule/pivot-scorer.ts`, and `src/utils/directory-weights.ts`.  
   Suggested fix: add strong vendor/minified/static penalties, detect generated bundles automatically, and bias server-side architectural queries toward backend roots when the repo profiler says this is a Spring backend.

2. **Graph navigation is broken on real Spring/Java and HTTP edges**: `cw_flow(createOrder)` returned no outgoing flows, `cw_impact(createOrder)` found no dependents, and `cw_flow(resources/static/.../cart.js:checkout)` could not trace the `/User/checkout` boundary.  
   Root cause: edge extraction and/or flow resolution is not producing usable call and route edges for this Java/Spring + frontend HTTP pattern; likely around Java call extraction in `src/core/queries/java.ts`, edge construction, and `src/mcp/tools/flow.ts` / `src/mcp/tools/impact.ts`.  
   Suggested fix: add Spring-specific flow fixtures, capture method-invocation edges through injected fields, and build explicit fetch/axios -> controller-route edges.

3. **Capsule follow-up suggestions are syntactically wrong**: Capsules repeatedly suggested `cw_read(file: "...", symbol: "...")`, but the actual `cw_read` schema expects `path`, not `file`. Those suggestions are not copy-paste valid.  
   Root cause: `src/capsule/formatter.ts:266,304` emits `file`, while `src/mcp/tools/read.ts` defines `path`.  
   Suggested fix: unify on one argument name immediately; easiest fix is accept `file` as an alias in `cw_read` and update formatter output.

4. **Exact symbol disambiguation is unstable when names collide**: `ProductModel` exact lookup ranked controller field injections above the class definition, and `cw_read` for admin `ProductModel` + symbol `ProductModel` returned the wrong `Shop` model class.  
   Root cause: suffix-based symbol resolution and ranking are not honoring explicit file intent strongly enough; likely in `src/mcp/tools/read.ts`, `src/mcp/tools/symbol-resolution.ts`, and exact-match ranking in `src/capsule/pivot-scorer.ts`.  
   Suggested fix: exact-definition fast path must beat usages, and file-qualified reads must hard-pin to the requested file before falling back to suffix heuristics.

### P1 (Important — degrades quality)
1. **Confidence is materially miscalibrated on vague concepts**: `state management` received `HIGH` confidence and `VERY_LOW` uncertainty for results that were obviously garbage. `error handling across the app` got `MEDIUM` even though it mostly returned vendor JS.  
   Root cause: current confidence scoring overweights lexical coverage and number of pivots while ignoring semantic sanity and path diversity; likely in `src/capsule/generator.ts` and confidence helpers.  
   Suggested fix: require backend-path concentration, semantic coherence, and exact query-term coverage before allowing `HIGH`.

2. **Budget utilization is catastrophically low**: At 8k token budgets, the system used 568 and 911 tokens respectively. Raising budget barely changed coverage.  
   Root cause: packer/retrieval loop stops early or never widens the neighborhood when spare budget exists; likely in `src/capsule/packer.ts` plus upstream retrieval limits in `src/capsule/generator.ts`.  
   Suggested fix: if utilization is below a floor, force another retrieval/packing pass and explain why unused budget could not be filled.

3. **Repo profiling mismatches this project’s conventions**: This codebase uses `*Model.java` as service/business logic, but `src/core/repo-profiler.ts:155` classifies `**/*Model.java` as `entities`. That is wrong for this repo and likely damages architectural priors.  
   Root cause: overly generic Spring heuristics in `src/core/repo-profiler.ts:152-156`.  
   Suggested fix: distinguish `Entity` roots from service-ish `Model` classes, or learn per-project suffix conventions from corpus signals / config.

4. **Overview path scoping is confusing and brittle**: `cw_overview(path: "java/com/example/KisanSathi", ...)` returned zero indexed files even though capsule paths and read outputs clearly resolve Java files.  
   Root cause: inconsistent project-relative path normalization inside `src/mcp/tools/overview.ts`.  
   Suggested fix: accept both normalized CW paths (`java/...`) and real project paths (`src/main/java/...`) everywhere.

5. **Session stats overstate first-pass success**: `cw_stats(session_id = taskB2-cw)` said `First-pass rate 100%` and `Avg follow-up reads 0.00` even though the task required a pile of extra `cw_read` and `cw_grep` calls after the capsule.  
   Root cause: `src/mcp/tools/stats.ts` only reads `capsule_log`, not actual follow-up tool activity.  
   Suggested fix: log read/search/flow tools against the session and compute first-pass from the full session trace, not capsule count alone.

6. **Memory recall amplifies prior bad retrievals**: `cw_recall("architecture")` mostly returned the earlier incorrect `state management` capsule as memory.  
   Root cause: low-quality capsule outputs are being promoted into recallable observations; likely in memory observation promotion/search paths.  
   Suggested fix: do not elevate low-confidence capsule summaries into recall unless they are explicitly user-confirmed or repeatedly validated.

### P2 (Moderate — papercut)
1. **Path formatting is inconsistent across tools**: Capsules emit `java/...`, reads print `src/main/java/...`, suggestions say `file`, the tool wants `path`, and file-qualified flow sometimes fails where symbol-only works.  
   Root cause: independent formatting/normalization logic across `formatter.ts`, `read.ts`, `overview.ts`, and flow resolution.  
   Suggested fix: centralize path normalization and argument rendering.

2. **`cw_reindex` output is misleading on unchanged repos**: A full refresh printed `444 files, 0 symbols`, which reads like a broken reindex instead of “all files skipped as unchanged.”  
   Root cause: CLI output is reporting “reprocessed symbols” without clarifying that the retained index is intact.  
   Suggested fix: print both retained index totals and changed-file work done.

## What Worked Well

- Exact-symbol capsules for unique names like `validateOTP`, `createOrder`, and `processOrder` usually put the real definition into the response.
- `cw_grep` is genuinely useful. The containing-symbol context is better than raw grep output and helped rescue multiple failed capsules.
- `cw_read` produces clean, bounded snippets when resolution succeeds.
- Project-root `cw_overview(query: "checkout flow")` gave a decent high-level starting map of the relevant JS and Java files.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 6 |
| Broad recall (found all relevant files) | 2 |
| Budget utilization (% of budget used) | 1 |
| Confidence calibration (honest scores) | 2 |
| Flow tracing (traces real call chains) | 1 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

- **Invalid follow-up syntax**
  - Query: `validateOTP signup and order flow`
  - Key response: `cw_read(file: "java/com/example/KisanSathi/OTP/Model/OTPGenerator.java", symbol: "validateOTP")`
  - Correct behavior: `cw_read` schema expects `path`, not `file`

- **Broken Java impact/flow**
  - Query: `cw_flow({ source: "createOrder" })`
  - Key response: `No outgoing flows found from "createOrder"`
  - Correct answer: `createOrder` directly calls `userRepo.findByEmail`, `cartRepo.findByUserId`, `emailSender.sendEmail`, `elasticOrderRepo.save`, and `orderRepo.save`

- **Broken HTTP flow tracing**
  - Query: `cw_flow({ source: "resources/static/.../cart.js:checkout" })`
  - Key response: `No outgoing flows found`
  - Correct answer: the JS function posts to `/User/checkout`, which hits `CartController.checkout`, then `CartModel.checkout`

- **Architectural query hijacked by vendor noise**
  - Query: `How are MongoDB and Elasticsearch dual writes handled across the app?`
  - Key response: top files were `menu.js`, form-validation bundles, and `plugins.js`
  - Correct answer: the relevant write paths live in `Admin/Products/Model/ProductModel.java` and `Admin/Products/Model/OrderModel.java`

- **Confidence dishonesty**
  - Query: `state management`
  - Key response: `Confidence: HIGH | Uncertainty: VERY_LOW`
  - Returned files: `permissions-list.json`, `states` arrays, `$state` variables in vendored JS
  - Correct answer: this repo does not have a coherent “state management” architecture in that sense; confidence should not be high

- **Exact symbol ranking failure**
  - Query: `ProductModel`
  - Capsule top result: `Admin/Products/Controller/ProductController.java` field injection
  - `cw_grep` top result: `CategoriesModel.productModel` field injection
  - Correct answer: the definition(s) of `ProductModel` should rank above usages

- **Overview path mismatch**
  - Query: `cw_overview({ query: "MongoDB Elasticsearch dual writes", path: "java/com/example/KisanSathi", depth: 3 })`
  - Key response: `No indexed files found for this scope`
  - Correct answer: that scope clearly contains indexed Java files; the path aliasing is inconsistent

- **Reindex metric confusion**
  - Command: `node dist/index.js reindex`
  - Key response: `444 files, 0 symbols (3258ms)` after `skipped 444 unchanged files`
  - Correct interpretation: index still existed; zero meant “nothing reprocessed,” not “project has zero symbols”
