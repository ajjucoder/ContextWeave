# ContextWeave Master Review Report — 2026-03-18

## Executive Summary

**Did the overhaul help?** Yes, measurably — but not enough to change the verdict. Token costs improved on every project. lawn achieved the **first positive savings ever recorded** (+41.2%). But capsule retrieval is still fundamentally unreliable on broad queries, and the "Would replace Grep+Explore?" answer remains **No** across all projects.

**Biggest win:** Flow tracing. `cw_flow` crossed HTTP boundaries in Kuvio (submitPublicInquiry -> POST route) and lawn (handleAccept -> acceptInvite). Scores jumped from 3-4 to 6-8. This is a unique capability grep cannot replicate.

**Biggest remaining failure:** Broad capsules miss the actual files. Every reviewer independently reported: the first capsule is wrong, recovery requires manual `cw_grep`/`cw_read`, and the follow-up suggestions are irrelevant.

---

## Round-Over-Round Comparison

### Scorecard Trends (averages across projects)

| Metric | R1 (Mar 10, 8 proj) | R3 (Mar 17, 4 proj) | R4 (Mar 18, 4 reviews) | Trend |
|--------|-----|-----|-----|------|
| Narrow precision | 7.8 | 4.0 | 5.3 | Recovering |
| Broad recall | 3.4 | 2.75 | 3.0 | Recovering |
| Budget utilization | 3.8 | 1.75 | 2.3 | Recovering |
| Confidence calibration | 3.8 | 2.0 | 4.0 | IMPROVED |
| Flow tracing | 3.4 | 2.5 | 5.3 | IMPROVED |
| Follow-up quality | 3.4 | 1.75 | 2.0 | Recovering |
| Token savings | 3.5 | 1.0 | 2.0 | Recovering |
| Would replace grep? | 0/8 | 0/4 | 0/4 | SAME |

**Key:** R3 (Mar 17) ran against main BEFORE the overhaul merge. R4 (Mar 18) ran AFTER the merge with fresh indexes. The improvement from R3 to R4 reflects the overhaul impact.

### Token Cost Comparison

| Project | R3 (Mar 17) | R4 (Mar 18) | Change |
|---------|-------------|-------------|--------|
| Kuvio (GPT-5.4) | -201.0% | -135.8% | +65 pp better |
| Kuvio (Opus 4.6) | n/a | -7.0% | Nearly break-even |
| lawn | -153.0% | **+41.2%** | **+194 pp** (first positive savings) |
| t3code | -101.2% | -64.6% | +37 pp better |

### Per-Project Detailed Scorecards

#### Kuvio — GPT-5.4 (high)

| Metric | Mar 17 | Mar 18 | Change |
|--------|--------|--------|--------|
| Narrow precision | 5 | 4 | -1 |
| Broad recall | 2 | 3 | +1 |
| Budget utilization | 2 | 2 | = |
| Confidence | 2 | 3 | +1 |
| Flow tracing | 4 | 6 | +2 |
| Follow-up quality | 2 | 1 | -1 |
| Token savings | 1 | 1 | = |
| Token cost | -201% | -136% | +65 pp |

#### Kuvio — Claude Opus 4.6

| Metric | Score | Notes |
|--------|-------|-------|
| Narrow precision | 7 | Definitions at #1, but surrounding noise |
| Broad recall | 3 | Consistently misses key files |
| Budget utilization | 4 | Narrow: 96-100%, Broad: 30-62% (bimodal) |
| Confidence | **8** | LOW means wrong, MEDIUM means partial — honest |
| Flow tracing | **8** | HTTP boundary tracing works; missing some incoming paths |
| Follow-up quality | 3 | Wrong tools/directories suggested |
| Token savings | 2 | -7% raw, but incomplete answers |
| Impact analysis | **9** | 46 affected symbols, 3 depths, all correct |

#### lawn — gpt-5.4-mini (xhigh)

| Metric | Mar 17 | Mar 18 | Change |
|--------|--------|--------|--------|
| Narrow precision | 4 | 4 | = |
| Broad recall | 2 | 3 | +1 |
| Budget utilization | 1 | 1 | = |
| Confidence | 2 | 2 | = |
| Flow tracing | 3 | 6 | **+3** |
| Follow-up quality | 2 | 2 | = |
| Token savings | 1 | **4** | **+3** |
| Token cost | -153% | **+41%** | **+194 pp** |

#### t3code — GPT-5.4 High

| Metric | Mar 17 | Mar 18 | Change |
|--------|--------|--------|--------|
| Narrow precision | 4 | 6 | +2 |
| Broad recall | 3 | 3 | = |
| Budget utilization | 2 | 2 | = |
| Confidence | 2 | 3 | +1 |
| Flow tracing | 2 | 1 | -1 |
| Follow-up quality | 1 | 2 | +1 |
| Token savings | 1 | 1 | = |
| Token cost | -101% | -65% | +36 pp |

---

## What Improved (Evidence-Based)

### 1. Flow Tracing (3.4 -> 5.3)
The overhaul's edge priority (call > import), test file filtering, and DFS backtracking are working. Specific wins:
- Kuvio: `submitPublicInquiry` -> `POST /api/submit-inquiry` via `[framework_entry]` edge (both GPT and Opus confirmed)
- lawn: `handleAccept` -> `acceptInvite` traced correctly
- lawn: `prewarmProject` -> `prewarmSpecs` static call traced

### 2. Confidence Calibration (2.0 -> 4.0)
The escape hatch removal and noise caps are taking effect. Opus 4.6 gave confidence 8/10, noting "LOW means wrong, MEDIUM means partial — trustworthy." However, GPT-5.4 still reports HIGH on wrong answers for vague queries like "error handling" and "state management."

### 3. Token Costs
Every project improved. lawn achieved the first recorded positive savings in 4 rounds of reviews. The `file:` -> `path:` fix alone saved significant tokens from failed follow-up attempts.

### 4. Narrow Precision (4.0 -> 5.3)
`normalizeModelSlug`, `submitPublicInquiry`, `validateOrigin`, `mapSite`, `useSitesStore`, `showToast` all ranked definition #1. The exact-match boost is working on distinctive symbols.

---

## What Still Fails (Critical Path to Adoption)

### 1. Broad Capsule Retrieval (3/10 across all reviews)
Every reviewer independently reported: the first capsule misses the real files. Examples:
- Kuvio: inquiry flow capsule returned `storage.ts` and `auth.ts` instead of `submit-inquiry/route.ts`
- lawn: prewarm query returned `Route` declarations instead of `convexRouteData.ts`
- t3code: prompt flow capsule used 33% budget and missed `wsServer.ts`, `decider.ts`, `ProviderRuntimeIngestion.ts`

### 2. Budget Utilization (7-43% on 8K budgets)
The packer improvement helped slightly but fundamental candidate shortage persists:
- lawn: 7.1% and 6.1% on 8K budgets
- t3code: 33% and 30%
- Kuvio: 43% and 24%

### 3. cw_impact False Negatives
Still happening despite the Java type binding fix:
- lawn: `resolveContext` — "No dependents found" (Convex api.* pattern not resolved)
- Kuvio: `updateSite` — only found local wrapper, missed all useSiteDataLayer consumers
- Kuvio (Opus): Confirmed `cw_impact("queries.ts:mapSite")` works perfectly (9/10) but `cw_impact("dataLayer.ts:updateSite")` misses hook consumers

### 4. Follow-up Suggestions (1-3/10)
Still suggesting wrong files:
- Kuvio: suggested `HowItWorks` landing page for inquiry flow
- lawn: suggested `fullTitle` for resolveContext, `Route` for prewarm architecture
- t3code: suggested wrong symbols with truncated paths

### 5. Path Canonicalization
t3code capsules output `store.ts` instead of `apps/web/src/store.ts`. The truncated paths break follow-up `cw_read` calls.

---

## Reviewer Model Ranking (Kuvio Reviews)

Three models reviewed Kuvio on the same day with the same codebase:

### 1st: Claude Opus 4.6 (Best)
- **Most thorough:** 306 lines, identified 12 distinct flaws, gave evidence snippets for each
- **Most nuanced:** Differentiated between "capsule failed but impact/flow are excellent" instead of blanket-negative
- **Discovered unique issues:** Capsule retrieval subset restriction (P0-1), three different file counts (P0-2), cw_grep only searches a subset (P0-3), mock data budget waste (P2-8)
- **Praised what works:** cw_impact 9/10, cw_flow HTTP tracing 8/10, confidence calibration 8/10
- **Most actionable verdict:** "Use cw_impact and cw_flow for change analysis, use grep+read for everything else"

### 2nd: GPT-5.4 (high)
- **Solid coverage:** 194 lines, 8 flaws identified, good evidence
- **Task-based approach:** 3 full tasks with token counts, completeness, winner
- **Less discriminating:** Gave 6/10 for flow but didn't highlight the HTTP boundary trace as exceptional
- **Actionable but less specific:** Root cause analysis points to files but fewer concrete fixes

### 3rd: GPT-5.4-mini (xhigh)
- **Used for code review, not field review:** The mini model was used to review a Kuvio branch (`feat/healthcare-sector`), not to evaluate ContextWeave as a tool
- **Found 4 real bugs:** Healthcare metadata not rendered, invalid CSS from rgba, construction presets for healthcare, unvalidated priceCategories
- **Not comparable:** Different task (code review vs tool evaluation)

---

## Healthcare Branch Code Reviews (3 models)

Three models reviewed the same Kuvio branch (`feat/healthcare-sector`). All found the same core issues:

| Finding | GPT-5.4 (high) standalone | GPT-5.4 (high) v2 | GPT-5.4-mini (xhigh) |
|---------|:---:|:---:|:---:|
| Healthcare metadata not rendered publicly | Found | Found | Found |
| Invalid CSS from rgba() + opacity | Found + call sites listed | Found | Found + call sites listed |
| Construction presets for healthcare | Found | Found (as "availability messaging") | Found |
| priceCategories without validation | Not found | Not found | Found |
| No test coverage for new features | Found | Found | Not found |
| Security audit failures (npm audit) | Found | Found | Found |

**Best code reviewer:** GPT-5.4-mini (xhigh) found the most bugs (4/4 core + e2e test results), GPT-5.4 (high) standalone was the most thorough with call site evidence.

---

## Metrics Summary (Mar 18 Post-Overhaul)

| Metric | Kuvio (GPT) | Kuvio (Opus) | lawn | t3code | Average |
|--------|:-----------:|:------------:|:----:|:------:|:-------:|
| Narrow precision | 4 | 7 | 4 | 6 | 5.3 |
| Broad recall | 3 | 3 | 3 | 3 | 3.0 |
| Budget utilization | 2 | 4 | 1 | 2 | 2.3 |
| Confidence | 3 | 8 | 2 | 3 | 4.0 |
| Flow tracing | 6 | 8 | 6 | 1 | 5.3 |
| Follow-up quality | 1 | 3 | 2 | 2 | 2.0 |
| Token savings | 1 | 2 | 4 | 1 | 2.0 |
| Would replace? | No | No-Partial | No | No | No |

---

## Top 5 Fixes Needed for Next Round

1. **Capsule retrieval must search the FULL index** — Opus discovered capsules draw from a restricted file subset while cw_impact/cw_flow use the full index. This is the #1 blocker.

2. **Budget-aware expansion** — When utilization < 30%, expand into adjacent coherent files instead of stopping. Every reviewer cited this.

3. **Path canonicalization** — Stop truncating `apps/web/src/store.ts` to `store.ts` in capsule output. This breaks follow-up commands.

4. **Convex/hook edge synthesis** — `useQuery(api.workspace.resolveContext)` needs to create an edge to `convex/workspace.ts:resolveContext`. This would fix the lawn false negatives.

5. **Follow-up ranking overhaul** — Rank by "what's missing from the answer" not "what scored highest in the noise pool."

---

## Conclusion

The overhaul materially improved flow tracing (+56%), confidence calibration (+100%), and token costs (every project better, lawn achieved +41% savings). But the core product promise — "one capsule replaces grep+explore" — still fails because broad retrieval draws from a restricted file subset and budget utilization collapses on hard queries.

**The path forward is clear:** Fix the capsule retrieval subset restriction (Opus P0-1), add budget-aware expansion, and fix path canonicalization. These three changes would address 80% of the remaining failures.
