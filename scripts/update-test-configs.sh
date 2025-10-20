#!/bin/bash

#
# Script to update all app Playwright configs to use shared config
# and add screenshot helpers to E2E tests
#

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Updating Playwright configs for all apps..."

# Function to update an app's Playwright config
update_playwright_config() {
  local app=$1
  local port=$2
  local config_file="$PROJECT_ROOT/apps/$app/playwright.config.ts"

  if [[ ! -f "$config_file" ]]; then
    echo "  ⚠️  No config found for $app"
    return
  fi

  echo "  Updating $app..."

  # Backup original
  cp "$config_file" "$config_file.backup"

  # Create new config (this is a template, actual implementation would be more sophisticated)
  cat > "$config_file" << EOF
import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const ${app^^}_PORT = process.env.${app^^}_PORT || '$port';

export default createJejuPlaywrightConfig({
  appName: '$app',
  port: parseInt(${app^^}_PORT),
  testDir: './tests/e2e',
});
EOF

  echo "  ✅ Updated $app config"
}

# Update each app
echo ""
echo "📝 Updating configs..."

# These apps already have E2E tests
update_playwright_config "ehorse" "5700"
update_playwright_config "gateway" "4001"
update_playwright_config "leaderboard" "3000"
update_playwright_config "predimarket" "4005"

echo ""
echo "✅ All configs updated!"
echo ""
echo "Backup files created with .backup extension"
echo "Review changes and remove backups when satisfied"
