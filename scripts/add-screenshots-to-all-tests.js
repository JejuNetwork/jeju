#!/usr/bin/env bun

/**
 * Enhanced script to add screenshot helpers to ALL E2E tests
 * Handles multiple import patterns
 */

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dir, '..');

const testFiles = glob.sync('apps/*/tests/e2e/**/*.spec.ts', { cwd: PROJECT_ROOT });
const walletTestFiles = glob.sync('apps/*/tests/e2e-wallet/**/*.spec.ts', { cwd: PROJECT_ROOT });
const allTestFiles = [...testFiles, ...walletTestFiles];

console.log(`Processing ${allTestFiles.length} E2E test files\n`);

let updated = 0;
let already = 0;
let skipped = 0;

for (const relPath of allTestFiles) {
  const filePath = join(PROJECT_ROOT, relPath);

  try {
    let content = readFileSync(filePath, 'utf-8');

    // Skip if already has screenshot imports
    if (content.includes('captureScreenshot') || content.includes('captureUserFlow')) {
      already++;
      continue;
    }

    // Pattern 1: import { test, expect } from '@playwright/test';
    const pattern1 = /import { test, expect } from '@playwright\/test';?/;

    // Pattern 2: import { expect } from '@playwright/test';
    const pattern2 = /import { expect } from '@playwright\/test';?/;

    // Pattern 3: Just import { test } from '@playwright/test';
    const pattern3 = /import { test } from '@playwright\/test';?/;

    let matched = false;

    if (pattern1.test(content)) {
      content = content.replace(
        pattern1,
        `import { test, expect } from '@playwright/test';\nimport { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';`
      );
      matched = true;
    } else if (pattern2.test(content)) {
      content = content.replace(
        pattern2,
        `import { expect } from '@playwright/test';\nimport { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';`
      );
      matched = true;
    } else if (pattern3.test(content)) {
      content = content.replace(
        pattern3,
        `import { test } from '@playwright/test';\nimport { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';`
      );
      matched = true;
    }

    if (matched) {
      writeFileSync(filePath, content);
      console.log(`✅ ${relPath}`);
      updated++;
    } else {
      console.log(`⚠️  ${relPath} (no matching import pattern)`);
      skipped++;
    }
  } catch (error) {
    console.log(`❌ ${relPath}: ${error.message}`);
    skipped++;
  }
}

console.log('\nSummary:');
console.log(`  ✅ Updated: ${updated}`);
console.log(`  ⏭️  Already had screenshots: ${already}`);
console.log(`  ⚠️  Skipped: ${skipped}`);
console.log(`  📊 Total with screenshots: ${updated + already}/${allTestFiles.length}`);

const percentage = Math.round(((updated + already) / allTestFiles.length) * 100);
console.log(`\n🎯 Screenshot coverage: ${percentage}%`);
