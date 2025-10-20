#!/usr/bin/env bun

/**
 * Script to migrate all app Playwright configs to use shared configuration
 * and add screenshot helpers import to E2E tests
 */

import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dir, '..');

// App configurations
const apps = [
  { name: 'ehorse', port: 5700, testDir: './tests/e2e', webServer: false, timeout: 180000 },
  { name: 'gateway', port: 4001, testDir: './tests/e2e', hasA2A: true },
  { name: 'leaderboard', port: 3000, testDir: './tests/e2e' },
  { name: 'predimarket', port: 4005, testDir: './tests' },
];

// Generate new config content
function generateConfig(app) {
  const portVar = `${app.name.toUpperCase()}_PORT`;

  let config = `import { createJejuPlaywrightConfig } from '../../tests/shared/playwright.config.base';

const ${portVar} = process.env.${portVar} || '${app.port}';

export default createJejuPlaywrightConfig({
  appName: '${app.name}',
  port: parseInt(${portVar}),
  testDir: '${app.testDir}',`;

  if (app.webServer === false) {
    config += `\n  webServer: false,`;
  } else if (app.hasA2A) {
    const a2aPort = process.env.A2A_PORT || '4003';
    config += `\n  webServer: process.env.CI ? false : [
    {
      command: 'bun run dev:ui',
      url: \`http://localhost:\${${portVar}}\`,
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: 'bun run dev:a2a',
      url: 'http://localhost:${a2aPort}',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],`;
  }

  if (app.timeout) {
    config += `\n  overrides: {
    timeout: ${app.timeout}, // Extended timeout for ${app.name}
  },`;
  }

  config += `\n});\n`;

  return config;
}

// Update Playwright configs
console.log('🔧 Migrating Playwright configs to shared configuration...\n');

for (const app of apps) {
  const configPath = join(PROJECT_ROOT, 'apps', app.name, 'playwright.config.ts');

  if (!existsSync(configPath)) {
    console.log(`⚠️  Config not found for ${app.name}, skipping`);
    continue;
  }

  try {
    // Backup original
    const backupPath = `${configPath}.backup`;
    const original = readFileSync(configPath, 'utf-8');
    writeFileSync(backupPath, original);

    // Write new config
    const newConfig = generateConfig(app);
    writeFileSync(configPath, newConfig);

    console.log(`✅ ${app.name}: Config updated`);
  } catch (error) {
    console.log(`❌ ${app.name}: Failed to update config - ${error.message}`);
  }
}

console.log('\n📸 Adding screenshot imports to E2E tests...\n');

// Function to add screenshot import to test files
function addScreenshotImport(testFile) {
  let content = readFileSync(testFile, 'utf-8');

  // Skip if already has screenshot import
  if (content.includes('screenshots')) {
    return false;
  }

  // Add import after @playwright/test import
  const playwrightImport = "import { test, expect } from '@playwright/test';";
  if (content.includes(playwrightImport)) {
    content = content.replace(
      playwrightImport,
      `${playwrightImport}\nimport { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';`
    );

    writeFileSync(testFile, content);
    return true;
  }

  return false;
}

// Add imports to all E2E test files
for (const app of apps) {
  const e2eDir = join(PROJECT_ROOT, 'apps', app.name, 'tests', 'e2e');

  if (!existsSync(e2eDir)) {
    console.log(`⚠️  E2E directory not found for ${app.name}`);
    continue;
  }

  const testFiles = readdirSync(e2eDir).filter(f => f.endsWith('.spec.ts'));
  let updated = 0;

  for (const file of testFiles) {
    const filePath = join(e2eDir, file);
    if (addScreenshotImport(filePath)) {
      updated++;
    }
  }

  console.log(`✅ ${app.name}: Added imports to ${updated}/${testFiles.length} test files`);
}

console.log('\n✨ Migration complete!\n');
console.log('Next steps:');
console.log('  1. Review the changes in each app');
console.log('  2. Update individual test files to use screenshot helpers');
console.log('  3. Run tests: ./scripts/test-app.sh <app-name>');
console.log('  4. Remove .backup files when satisfied\n');
