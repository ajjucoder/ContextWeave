#!/bin/bash
# Security Fix Mission - Environment Setup
# This script is idempotent - safe to run multiple times

set -e

echo "=== ContextWeave Security Fix Mission Setup ==="

# Check Node.js/npm availability
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found. Please install Node.js."
    exit 1
fi

# Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Verify better-sqlite3 is installed (needed for tests)
if [ ! -f "node_modules/better-sqlite3/package.json" ]; then
    echo "Installing better-sqlite3..."
    npm install better-sqlite3
fi

echo "Environment ready for security fixes."
echo ""
echo "Available commands:"
echo "  npm test           - Run full test suite"
echo "  npm run typecheck  - Run TypeScript type checking"
echo "  npm run lint       - Run linting"
echo "  npm run build      - Build the project"
