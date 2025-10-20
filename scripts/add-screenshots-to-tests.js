#!/usr/bin/env bun

/**
 * Script to add screenshot helpers to all E2E tests that don't have them yet
 * This ensures 100% screenshot coverage
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { glob } from 'glob';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dir, '..');

// Find all E2E test files
const testFiles = glob.sync('apps/*/tests/e2e/**/*.spec.ts', { cwd: PROJECT_ROOT });
const walletTestFiles = glob.sync('apps/*/tests/e2e-wallet/**/*.spec.ts', { cwd: PROJECT_ROOT });
const allTestFiles = [...testFiles, ...walletTestFiles];

console.log(`Found ${allTestFiles.length} E2E test files`);
console.log('');

let updated = 0;
let skipped = 0;
let errors = 0;

for (const relPath of allTestFiles) {
  const filePath = join(PROJECT_ROOT, relPath);

  try {
    let content = readFileSync(filePath, 'utf-8');

    // Skip if already has screenshot imports
    if (content.includes('captureScreenshot') || content.includes('captureUserFlow')) {
      skipped++;
      continue;
    }

    // Skip if no @playwright/test import (might be a different test type)
    if (!content.includes("from '@playwright/test'")) {
      console.log(`⚠️  Skipping ${relPath} (no Playwright import)`);
      skipped++;
      continue;
    }

    // Add import after @playwright/test import
    const playwrightImport = /import { test, expect } from '@playwright\/test';?/;
    if (content.match(playwrightImport)) {
      content = content.replace(
        playwrightImport,
        `import { test, expect } from '@playwright/test';\nimport { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';`
      );

      writeFileSync(filePath, content);
      console.log(`✅ Updated: ${relPath}`);
      updated++;
    } else {
      console.log(`⚠️  Could not update ${relPath} (import pattern not found)`);
      skipped++;
    }
  } catch (error) {
    console.log(`❌ Error processing ${relPath}: ${error.message}`);
    errors++;
  }
}

console.log('');
console.log('Summary:');
console.log(`  Updated: ${updated}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Errors: ${errors}`);
console.log('');
console.log('Next steps:');
console.log('  1. Review updated files');
console.log('  2. Add captureScreenshot() or captureUserFlow() calls in test bodies');
console.log('  3. Run tests to verify screenshots are generated');
