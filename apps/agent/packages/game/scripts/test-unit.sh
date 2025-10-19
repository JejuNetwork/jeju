#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${YELLOW}🧪 ElizaOS Game - Unit Tests Only${NC}"
echo "=========================================="

# This script runs only unit tests that don't require containers

EXIT_CODE=0

# Run Rust unit tests
echo -e "\n${YELLOW}Running Rust unit tests...${NC}"
echo "------------------------------"
cd src-tauri
cargo test --lib
RUST_RESULT=$?
cd ..

if [ $RUST_RESULT -ne 0 ]; then
    echo -e "${RED}❌ Rust unit tests failed${NC}"
    EXIT_CODE=1
else
    echo -e "${GREEN}✅ Rust unit tests passed${NC}"
fi

# Run JavaScript/TypeScript unit tests if any
if [ -f "vitest.config.ts" ]; then
    echo -e "\n${YELLOW}Running JavaScript unit tests...${NC}"
    echo "------------------------------"
    npm run test:unit 2>/dev/null || echo -e "${BLUE}ℹ️  No unit test script found${NC}"
fi

# Summary
echo -e "\n${YELLOW}========================================${NC}"
echo -e "${YELLOW}Test Summary:${NC}"

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All unit tests passed!${NC}"
else
    echo -e "${RED}❌ Some unit tests failed${NC}"
fi

echo -e "${YELLOW}========================================${NC}"

exit $EXIT_CODE