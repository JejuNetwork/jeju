#!/bin/bash

# Script to run E2E tests for leaderboard
set -e

echo "🧹 Cleaning up any existing processes..."
pkill -f "next dev" || true
sleep 2

echo "🚀 Starting dev server..."
bun run dev > /tmp/leaderboard-dev.log 2>&1 &
DEV_PID=$!

echo "⏳ Waiting for server to be ready..."
sleep 10

# Wait for server to respond
for i in {1..30}; do
  if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Server is ready!"
    break
  fi
  echo "   Attempt $i/30..."
  sleep 2
done

echo "🧪 Running E2E tests..."
npx playwright test --config playwright.e2e.config.ts --reporter=list,html

TEST_EXIT_CODE=$?

echo "🛑 Stopping dev server..."
kill $DEV_PID || true
pkill -f "next dev" || true

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ All E2E tests passed!"
  echo "📸 Screenshots saved to test-results/screenshots/"
  echo "📊 Report available at: playwright-report/leaderboard/index.html"
else
  echo "❌ E2E tests failed with exit code $TEST_EXIT_CODE"
fi

exit $TEST_EXIT_CODE
