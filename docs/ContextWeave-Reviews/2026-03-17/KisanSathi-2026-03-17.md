# ContextWeave Field Review: KisanSathi

**Date:** 2026-03-17
**ContextWeave Version:** `cw_status` did not report a version; local runtime used `/Users/aejjusingh/Developer/ContextWeave` `package.json` version `0.1.0`

## Project Profile

| Metric | Value |
|--------|-------|
| Project | KisanSathi (`KISAN-SATHI-aejjuwork`) |
| Stack | Spring Boot 3.5.3, Java, Maven, MongoDB, Elasticsearch, static JS/HTML frontend |
| Lines of Code | 213,227 |
| Source Files | 1,044 scanned by shell profile; 444 indexed by ContextWeave |
| Symbols Indexed | 2,773 |
| Languages | javascript, java, json, markdown, yaml, php |
| Index Time | 164 ms no-op reindex on existing DB; cold-build time not exposed by `cw_status` |
| Architecture | Spring Boot monolith with controller/service/repo layers plus static frontend assets and large vendored template JS |
| Key Directories | `src/main/java/com/example/KisanSathi`, `src/main/resources/static/vegefoods-master/vegefoods-master`, `src/main/resources/static/Frontend` |

## Task-Based Results

### Task A: Understand `deleteProduct` including callers and side effects

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 2,965 | 1,216 |
| Tool calls | 4 | 5 |
| Completeness | Partial | Complete |
| Time to correct answer | Slower; needed recovery after wrong follow-up | Faster |

**What ContextWeave found:** admin `ProductController.deleteProduct`, `ProductModel.deleteProduct`, and the existence of frontend/template `deleteProduct` implementations.

**What ContextWeave missed:** the real dependent in `CategoriesModel.deleteCategory`, the actual file-side-effect helper `deleteProductPicture`, and any usable impact graph. `cw_impact` falsely said there were no dependents.

**Follow-up suggestions useful?** No. It suggested reading `deleteAllInsideUploads`, which is unrelated to single-product deletion.

**Winner:** Grep+Read

### Task B: Trace cart checkout to order placement end-to-end

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 5,084 | 3,528 |
| Tool calls | 8 | 6 |
| Completeness | Complete, but only after manual steering | Complete |
| Time to correct answer | Slower; capsule missed the real frontend order file and `cw_flow` failed | Faster |

**What ContextWeave found:** `CheckoutController.checkout`, `OrderModel.createOrder`, `CartController.checkout`, `CartModel.checkout`, `CartModel.deleteCartAfterSales`, and the `/User/order` literal once I switched to `cw_grep`.

**What ContextWeave missed:** the first capsule did not surface `src/main/resources/static/vegefoods-master/vegefoods-master/js/WebJS/checkout.js` even though that is the real frontend order submission path. `cw_flow(orderRequest -> createOrder)` failed entirely.

**Follow-up suggestions useful?** Mostly no. Suggested reads focused on `Cart` and controller fields instead of the actual frontend submit function or the HTTP boundary.

**Winner:** Grep+Read

### Task C: How is error handling done across the app?

| Metric | ContextWeave | Grep+Read |
|--------|-------------|-----------|
| Total tokens | 7,958 | 4,031 |
| Tool calls | 8 | 5 |
| Completeness | Partial | Complete |
| Time to correct answer | Much slower; initial answer was mostly vendor noise | Faster |

**What ContextWeave found:** after manual steering, it eventually exposed `ValidationExceptionHandler`, some inline `ResponseEntity.status(...)` usage, and the custom `CustomErrorController`.

**What ContextWeave missed:** the first capsule was catastrophically off-target. It spent most of its budget on template/vendor JS (`modernizr.js`, `aos.js`, `menu.js`) and still reported `MEDIUM` confidence. It did not give a trustworthy app-wide picture without multiple manual corrections.

**Follow-up suggestions useful?** No. The first narrowing suggestion used `java/com/example/KisanSathi`, which `cw_overview` then reported as having `0` indexed files. I had to discover the full `src/main/java/...` path manually.

**Winner:** Grep+Read

**Overall token comparison:**
- Total ContextWeave tokens across 3 tasks: 16,007
- Total Grep+Read tokens across 3 tasks: 8,775
- Actual savings: `-82.4%` (ContextWeave used 82.4% more tokens)

## Stress Test Results

### Exact Symbol Ranking
| Symbol | Definition at #1? | What outranked it? |
|--------|------------------|--------------------|
| `sendOtp` | No | `OneShotOTPModel` class/file wrapper outranked the `sendOtp` function |
| `generateOrderOtp` | No | `CheckoutController` class/file wrapper outranked the `generateOrderOtp` function |
| `mailCantFoundException` | No | `ValidationExceptionHandler` class wrapper outranked the `mailCantFoundException` method |

### Confidence Honesty
| Query | Confidence | Tokens Used/Budget | Was confidence earned? |
|-------|-----------|-------------------|----------------------|
| `state management` | HIGH | 1593 / 2000 | No — top hits were `permissions-list.json` and vendor validator bundles, not real application state architecture |
| `error handling across the app` | MEDIUM | 2097 / 2400 | No — top hits were mostly vendor/template JS while real Java exception patterns were missed initially |

### Budget Utilization
| Query | Budget | Used | Utilization |
|-------|--------|------|-------------|
| Product/Order dual-write query | 8000 | 1150 | 14% |
| Checkout flow query | 8000 | 1085 | 14% |

### Flow Tracing
| Function | Direct call traced? | Callback/HTTP traced? | Issues |
|----------|-------------------|-----------------------|--------|
| `createAccountRequest -> sendOtp` | No | n/a | Missed a straightforward Java cross-file call |
| `orderRequest -> createOrder` | n/a | No | No JS `axios` -> Spring route -> service trace at all |

### Supporting Tools
| Tool | Query | Grade (1-10) | Issues |
|------|-------|-------------|--------|
| `cw_overview` | `order flow` | 4 | Good for hotspot listing, weak for actual flow understanding |
| `cw_recall` | `order flow` | 2 | Mostly passive auto-query telemetry, duplicated, low signal |
| `cw_impact` | `deleteProduct` | 1 | False negative on obvious dependents |
| `cw_stats` | session stats | 3 | Nice format, misleading metrics; reported `Indexed: 38 files, 76 symbols` in a repo `cw_status` says has `444 files, 2773 symbols` |

## Flaws Found

Ordered by severity. Each finding includes what happened, why it likely happened, and how to fix it.

### P0 (Critical — blocks adoption)
1. **Architectural queries are swamped by vendor/template code**: `cw_capsule("error handling across the app")` mostly returned `modernizr.js`, `aos.js`, template menu code, and form-validation bundles instead of the app’s Java exception handling. This makes the tool unsafe for broad understanding tasks. Root cause is likely ranking/scope weighting in [`src/core/hybrid-ranker.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/hybrid-ranker.ts), [`src/utils/directory-weights.ts`](/Users/aejjusingh/Developer/ContextWeave/src/utils/directory-weights.ts), and query decomposition in [`src/capsule/query-decomposer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/query-decomposer.ts), which are not aggressively downranking vendored/generated assets. Fix: add first-party vs vendored weighting, default penalties for bundled template paths, and confidence gating on first-party coverage, not raw retrieval coverage.
2. **`cw_flow` cannot trace real flows in this repo**: it failed on both a direct Java cross-file call (`createAccountRequest -> sendOtp`) and an HTTP/JS boundary (`orderRequest -> createOrder`). That means it cannot replace manual tracing. Root cause is likely missing edge extraction or resolution in [`src/core/parser.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/parser.ts) plus pathing/resolution gaps in [`src/mcp/tools/flow.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/flow.ts). Fix: add Java method-call edges, JS string-literal route edges for Spring mappings, and a regression fixture from this repo.
3. **`cw_impact` returns false negatives on obvious dependents**: `cw_impact(target: ProductModel.deleteProduct)` reported “No dependents found” even though `ProductController.deleteProduct` and `CategoriesModel.deleteCategory` clearly call it. Root cause is likely symbol-resolution or dependency traversal failure in [`src/mcp/tools/impact.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/impact.ts) and/or upstream call-edge extraction in [`src/core/parser.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/parser.ts). Fix: add Java call-site dependents for same-package Spring code and regression tests for file-qualified Java methods.

### P1 (Important — degrades quality)
1. **Follow-up guidance is often wrong**: for the `deleteProduct` task, the capsule suggested reading `deleteAllInsideUploads`, which is not the side effect of single-product deletion. Root cause is likely low-quality follow-up selection in [`src/capsule/formatter.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/formatter.ts) and packing heuristics in [`src/capsule/packer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/packer.ts). Fix: validate suggested reads against the top-ranked symbol neighborhood and query terms before showing them.
2. **Tool path formats are inconsistent across the tool surface**: capsule suggestions use `java/com/example/...`, `cw_read` accepts file-qualified symbols, but `cw_overview` with the suggested path returned `Indexed Files: 0`, and `cw_flow` rejected both shortened and full file-qualified paths for the controller method. Root cause is inconsistent normalization across [`src/mcp/tools/overview.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/overview.ts), [`src/mcp/tools/flow.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/flow.ts), and formatter suggestions in [`src/capsule/formatter.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/formatter.ts). Fix: normalize all path inputs to one canonical project-root-relative format internally.
3. **Exact symbol lookup is not exact enough**: `sendOtp`, `generateOrderOtp`, and `mailCantFoundException` all ranked enclosing classes/files above the actual function definition. Root cause is likely ranking logic in [`src/core/hybrid-ranker.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/hybrid-ranker.ts) and capsule generation in [`src/capsule/generator.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/generator.ts) not having an exact-name definition fast path. Fix: exact-symbol queries should hard-boost exact function/method definitions ahead of class wrappers and related symbols.
4. **Large token budgets are mostly wasted**: on 8k budgets, both broad queries used only 14% of the available budget. The tool is staying thin instead of recovering with more relevant context. Root cause is likely early stopping or conservative packing in [`src/capsule/packer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/packer.ts). Fix: if confidence is low and budget remains, expand into the next-best first-party files instead of stopping early.
5. **Confidence calibration is not trustworthy**: `state management` got `HIGH` confidence even though the top hits were a permissions JSON file and vendor validation libs; `error handling across the app` got `MEDIUM` while missing the actual app patterns. Root cause is probably confidence being derived from internal retrieval coverage rather than semantic correctness in [`src/capsule/generator.ts`](/Users/aejjusingh/Developer/ContextWeave/src/capsule/generator.ts) and formatter/confidence helpers. Fix: incorporate first-party coverage, directory diversity, symbol exactness, and penalty for vendor concentration into confidence scoring.
6. **Stats/reporting are misleading**: `cw_stats` said the session had `Indexed: 38 files, 76 symbols`, while `cw_status` reported `444 files, 2773 symbols` for the project. `cw_stats` also called budget utilization “healthy” despite repeated failed/partial tasks. Root cause is likely session-local stats being presented as global truth in [`src/mcp/tools/stats.ts`](/Users/aejjusingh/Developer/ContextWeave/src/mcp/tools/stats.ts). Fix: label session-local stats explicitly and pair them with project-global numbers from `cw_status`.

### P2 (Moderate — papercut)
1. **`cw_reindex` and background graph reporting look broken in dev/runtime mode**: a reindex on this repo reported `444 files, 0 symbols (164ms)` and logged a PageRank worker `ERR_MODULE_NOT_FOUND` for `src/db/queries/symbols.js`. Root cause is likely summary wording in [`src/core/indexer.ts`](/Users/aejjusingh/Developer/ContextWeave/src/core/indexer.ts) and module resolution around [`src/db/queries/symbols.ts`](/Users/aejjusingh/Developer/ContextWeave/src/db/queries/symbols.ts). Fix: do not say “0 symbols” on no-op reindex, and fix worker imports under `tsx`/dev execution.
2. **`cw_recall` is low-value on real review work**: it mostly surfaced duplicate passive “query resolved to” telemetry instead of useful durable knowledge. Root cause is likely passive observation weighting/deduping in memory retrieval. Fix: dedupe passive observations and downrank auto-query telemetry more aggressively unless explicitly requested.
3. **`cw_status` not reporting the server version is a small but real ops problem**: I had to inspect `package.json` to know what version I was reviewing. Fix: include runtime version in `cw_status`.

## What Worked Well

- `cw_read` is genuinely useful once you already know the exact file-qualified symbol.
- `cw_grep` is solid for literal string pivots like `/User/order`.
- When ContextWeave does not know enough, it often lowers confidence instead of bluffing. The problem is that the confidence floor still is not low enough on broad noisy queries.
- `cw_overview` with the correct full path is decent for a quick “where are the large hotspots?” scan.

## Scorecard

| Metric | Score (1-10) |
|--------|-------------|
| Narrow precision (right symbol, right rank) | 3 |
| Broad recall (found all relevant files) | 4 |
| Budget utilization (% of budget used) | 2 |
| Confidence calibration (honest scores) | 2 |
| Flow tracing (traces real call chains) | 1 |
| Follow-up quality (suggested reads were useful) | 2 |
| Token savings vs grep+read (measured, not claimed) | 1 |
| **Overall: Would replace Grep+Explore?** | **No** |

## Evidence Snippets

- Query: `cw_capsule("error handling across the app", 2400)`
  Key response: `Confidence: MEDIUM`; top files included `modernizr.js`, `aos.js`, `menu.js`
  Correct answer should have centered `ValidationExceptionHandler`, `CartController`, `CheckoutController`, `CustomErrorController`, and broad inline `ResponseEntity.status(...)` use in Java controllers.

- Query: `cw_capsule("How does deleteProduct work, including its callers and side effects?", 1800)`
  Key response: suggested `cw_read(...FileModel.java, deleteAllInsideUploads)`
  Correct answer should have pointed to `deleteProductPicture` and `CategoriesModel.deleteCategory`.

- Query: `cw_impact(target: "java/com/example/KisanSathi/Admin/Products/Model/ProductModel.java:deleteProduct")`
  Key response: `No dependents found`
  Correct answer should have included at least `ProductController.deleteProduct` and `CategoriesModel.deleteCategory`.

- Query: `cw_flow(source: "createAccountRequest", target: "sendOtp")`
  Key response: `No path found ... within 4 hops`
  Correct answer should have found `AccountModel.createAccountRequest -> OneShotOTPModel.sendOtp`.

- Query: `cw_overview(path: "java/com/example/KisanSathi", query: "error handling across the app")`
  Key response: `Indexed Files: 0`
  Correct answer should have recognized the Java app scope; using `src/main/java/com/example/KisanSathi` immediately returned `77` indexed files.

- Query: `cw_reindex()`
  Key response: `Reindexed project: 444 files, 0 symbols (164ms)` plus PageRank worker `ERR_MODULE_NOT_FOUND`
  Correct behavior should not claim `0 symbols` on a healthy indexed repo and should not crash its background worker.
