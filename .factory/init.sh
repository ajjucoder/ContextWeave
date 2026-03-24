#!/bin/bash
# ContextWeave v2 Implementation Mission - Environment Setup
# This script is idempotent - safe to run multiple times

set -e

echo "=== ContextWeave v2 Implementation Mission Setup ==="

# Check Node.js/npm availability
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found. Please install Node.js."
    exit 1
fi

# Check Git availability (needed for git-lineage feature)
if ! command -v git &> /dev/null; then
    echo "WARNING: git not found. Git lineage features will not work."
fi

# Install base dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "Installing base dependencies..."
    npm install
fi

# Verify core dependencies
for pkg in better-sqlite3 typescript vitest zod; do
    if [ ! -f "node_modules/$pkg/package.json" ]; then
        echo "Installing $pkg..."
        npm install "$pkg"
    fi
done

# Install optional dependencies upfront for Phases 2-4
echo "Installing optional dependencies for Phase 2+..."

# chokidar for file watching v2 (Phase 2)
if [ ! -f "node_modules/chokidar/package.json" ]; then
    echo "Installing chokidar..."
    npm install chokidar
fi

# @xenova/transformers for ONNX embeddings/reranking (Phase 3)
if [ ! -f "node_modules/@xenova/transformers/package.json" ]; then
    echo "Installing @xenova/transformers..."
    npm install @xenova/transformers
fi

echo ""
echo "Environment ready for ContextWeave v2 implementation."
echo ""
echo "Available commands:"
echo "  npm test           - Run full test suite"
echo "  npm run typecheck  - Run TypeScript type checking"
echo "  npm run lint       - Run linting"
echo "  npm run build      - Build the project"
echo "  npm run eval       - Run evaluation suite"
echo "  npm run bench      - Run benchmarks"
echo "  npm run test:field - Run field regression tests"
echo ""
echo "Milestones:"
echo "  Pre-existing: Fix 5 TS errors + 42 test failures"
echo "  Milestone 1: Foundation (Items #1-22) - Audit fixes + decompose generator.ts"
echo "  Milestone 2: Graph & Search + UX (Items #23-37) - Algorithms + budget controls"
echo "  Milestone 3: Hybrid + History + Reranking (Items #38-45) - Embeddings + git"
echo "  Milestone 4: Advanced (Items #46-50) - Iterative + multi-repo"
