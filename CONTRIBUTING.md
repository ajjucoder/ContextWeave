# Contributing to ContextWeave

Thanks for your interest in contributing.

## Setup

```bash
git clone https://github.com/ajjucoder/ContextWeave.git
cd ContextWeave
npm install
npm run build
```

Requires Node.js >= 22.

## Development

```bash
npm run dev       # watch mode
npm test          # run tests
npm run lint      # type check
npm run bench     # benchmark harness
npm run bench:100k # synthetic 100K LOC harness
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Add tests for new functionality
3. Make sure `npm test` and `npm run lint` pass
4. Submit a pull request

## Code Style

- TypeScript, no code comments unless the logic is non-obvious
- `const` over `let`, `async/await` over `.then()`
- Named imports, avoid `any`
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `perf:`, `chore:`

## Tests

Tests live in `tests/` mirroring the `src/` structure. Run the full suite with `npm test`. The standard benchmark harness (`npm run bench`) uses fixture data in `bench/scenarios/`. The scale harness (`npm run bench:100k`) generates a deterministic synthetic 100K LOC project and validates retrieval/latency/token targets.

## Reporting Issues

Open an issue with:
- What you expected vs what happened
- Node.js version and OS
- Minimal reproduction steps
