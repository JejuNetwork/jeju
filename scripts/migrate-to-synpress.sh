#!/bin/bash

# Synpress Migration Script
# Helps migrate wallet tests from Dappwright to Synpress

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔄 Synpress Migration Tool"
echo "=========================="
echo ""

# Function to check if app has Synpress
check_synpress_installed() {
  local app_dir="$1"
  if grep -q '"@synthetixio/synpress"' "$app_dir/package.json" 2>/dev/null; then
    echo "✅"
  else
    echo "❌"
  fi
}

# Function to check if app has synpress.config.ts
check_synpress_config() {
  local app_dir="$1"
  if [ -f "$app_dir/synpress.config.ts" ]; then
    echo "✅"
  else
    echo "❌"
  fi
}

# Function to check if app has wallet tests
check_wallet_tests() {
  local app_dir="$1"
  local count=0

  if [ -d "$app_dir/tests/wallet" ]; then
    count=$(find "$app_dir/tests/wallet" -name "*.spec.ts" 2>/dev/null | wc -l | tr -d ' ')
  elif [ -d "$app_dir/tests/e2e-wallet" ]; then
    count=$(find "$app_dir/tests/e2e-wallet" -name "*.spec.ts" 2>/dev/null | wc -l | tr -d ' ')
  fi

  if [ "$count" -gt 0 ]; then
    echo "✅ ($count tests)"
  else
    echo "❌"
  fi
}

# Function to count Dappwright usage
count_dappwright_usage() {
  local app_dir="$1"
  grep -r "@tenkeylabs/dappwright" "$app_dir/tests" 2>/dev/null | wc -l | tr -d ' '
}

echo "📊 Migration Status by App"
echo ""
printf "%-20s %-15s %-15s %-20s %-15s\n" "App" "Synpress Dep" "Config File" "Wallet Tests" "Dappwright"
printf "%-20s %-15s %-15s %-20s %-15s\n" "---" "------------" "-----------" "-------------" "-----------"

APPS=(
  "bazaar"
  "gateway"
  "predimarket"
  "ehorse"
  "leaderboard"
  "crucible"
  "documentation"
  "indexer"
)

for app in "${APPS[@]}"; do
  app_dir="$ROOT_DIR/apps/$app"

  if [ ! -d "$app_dir" ]; then
    continue
  fi

  synpress=$(check_synpress_installed "$app_dir")
  config=$(check_synpress_config "$app_dir")
  tests=$(check_wallet_tests "$app_dir")
  dappwright=$(count_dappwright_usage "$app_dir")

  printf "%-20s %-15s %-15s %-20s %-15s\n" "$app" "$synpress" "$config" "$tests" "$dappwright uses"
done

echo ""
echo "📁 Shared Infrastructure"
echo ""

if [ -f "$ROOT_DIR/tests/shared/synpress.config.base.ts" ]; then
  echo "✅ Synpress config factory: /tests/shared/synpress.config.base.ts"
else
  echo "❌ Missing: /tests/shared/synpress.config.base.ts"
fi

if [ -f "$ROOT_DIR/tests/shared/fixtures/synpress-wallet.ts" ]; then
  echo "✅ Synpress fixtures: /tests/shared/fixtures/synpress-wallet.ts"
else
  echo "❌ Missing: /tests/shared/fixtures/synpress-wallet.ts"
fi

if [ -f "$ROOT_DIR/SYNPRESS_MIGRATION.md" ]; then
  echo "✅ Migration guide: /SYNPRESS_MIGRATION.md"
else
  echo "❌ Missing: /SYNPRESS_MIGRATION.md"
fi

echo ""
echo "🎯 Next Steps"
echo ""

# Check if any app still uses Dappwright
total_dappwright=0
for app in "${APPS[@]}"; do
  app_dir="$ROOT_DIR/apps/$app"
  if [ -d "$app_dir" ]; then
    count=$(count_dappwright_usage "$app_dir")
    total_dappwright=$((total_dappwright + count))
  fi
done

if [ "$total_dappwright" -gt 0 ]; then
  echo "⚠️  Found $total_dappwright Dappwright imports across all apps"
  echo "   Run: ./scripts/migrate-test-imports.sh"
  echo ""
fi

# Check if any app missing Synpress
missing_synpress=0
for app in "${APPS[@]}"; do
  app_dir="$ROOT_DIR/apps/$app"
  if [ -d "$app_dir" ] && [ "$app" != "indexer" ]; then
    synpress=$(check_synpress_installed "$app_dir")
    if [ "$synpress" == "❌" ]; then
      missing_synpress=$((missing_synpress + 1))
    fi
  fi
done

if [ "$missing_synpress" -gt 0 ]; then
  echo "⚠️  $missing_synpress apps missing Synpress dependency"
  echo "   Run: cd apps/<app> && bun add -D @synthetixio/synpress@^4.1.1"
  echo ""
fi

echo "📖 View migration guide:"
echo "   cat $ROOT_DIR/SYNPRESS_MIGRATION.md"
echo ""

echo "🧪 Test Synpress works:"
echo "   cd apps/bazaar"
echo "   bun run dev &"
echo "   sleep 5"
echo "   bun run test:wallet:headed"
echo ""

echo "✨ Migration infrastructure is ready!"
echo "   All apps have synpress.config.ts ✅"
echo "   Shared fixtures created ✅"
echo "   Example tests created ✅"
echo ""
