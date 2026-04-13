# Real Benchmark Follow-up — Work Log

**Date:** 2026-04-14
**Branch:** codex/trust-and-search-fixes
**Baseline commit:** edb93d2
**Current commit tested:** a673f3d

## Goal

Verify with real runs whether the recent trust and performance work made ContextWeave better.

## What was tested

### Small benchmark
- Ran `npm run bench` on the baseline and current code
- Compared wall time and query latency

### Real repo checks
- Ran the same helper tasks on local copies of `express` and `fastify`
- Used the same repo snapshots for both baseline and current runs
- Compared wall time, task success, and tokens to success

### Broad product benchmark
- Ran `npm run bench:product` once on both sides as a sanity check
- Treated this as supporting evidence only, not the main result, because repo clone coverage differed between runs

## Results

### Small benchmark improved
- Wall time: `1.17s -> 1.03s`
- Query latency sum: `29ms -> 27ms`
- Average reduction stayed the same at `77.6%`

This means the smaller benchmark got faster without changing the reduction result.

### Express improved clearly
- Wall time: `2.15s -> 1.47s`
- First-pass task success stayed at `3/3`
- Tokens to success: `3403 -> 2950`

This is a real improvement: same quality, lower token cost, faster runtime.

### Fastify got faster but not smarter
- Wall time: `6.18s -> 3.61s`
- Task outcome stayed the same: both versions still missed the same `2/2` tasks
- Tokens to success stayed the same at `5768`

This means the performance work helped runtime here, but retrieval quality did not improve on these tasks.

## Conclusion

Yes, the recent work made ContextWeave better in real runs.

The strongest evidence is:
- smaller benchmark runtime improved
- `express` runtime and token efficiency improved with no quality loss
- `fastify` runtime improved a lot, but retrieval quality stayed flat

So the current batch is a confirmed performance win, with quality holding steady on the checked cases rather than improving across the board.

## Notes

- The broad `bench:product` run was not fully apples-to-apples, so it should not be used as the main proof point
- After the benchmark runs, there were no leftover Node processes holding memory open
