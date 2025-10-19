#!/bin/bash

# Load environment variables from root .env file
if [ -f "../../.env" ]; then
  export $(cat ../../.env | grep -E '^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|E2B_API_KEY)=' | xargs)
  echo "✅ Loaded API keys from .env"
else
  echo "⚠️  No .env file found at root"
fi

# Check which keys are available
echo ""
echo "🔑 Available API Keys:"
[ ! -z "$OPENAI_API_KEY" ] && echo "   ✓ OPENAI_API_KEY"
[ ! -z "$ANTHROPIC_API_KEY" ] && echo "   ✓ ANTHROPIC_API_KEY"
[ ! -z "$GITHUB_TOKEN" ] && echo "   ✓ GITHUB_TOKEN"
[ ! -z "$E2B_API_KEY" ] && echo "   ✓ E2B_API_KEY"
echo ""

# Run specific test file if provided, otherwise run all tests
if [ "$1" ]; then
  echo "🧪 Running test: $1"
  bun test "$1"
else
  echo "🧪 Running all tests"
  bun test
fi