/**
 * Global teardown for Playwright/Synpress tests
 * 
 * This runs once after all tests:
 * 1. Cleans up any test resources
 * 2. Generates summary report
 */

import { FullConfig } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

async function globalTeardown(config: FullConfig) {
  console.log('\n🧹 Global Teardown Starting...\n');

  const outputDir = join(process.cwd(), 'test-results');
  
  // Read test environment info
  const envFile = join(outputDir, 'test-env.json');
  if (existsSync(envFile)) {
    try {
      const envInfo = JSON.parse(readFileSync(envFile, 'utf-8'));
      envInfo.endTime = new Date().toISOString();
      envInfo.duration = Date.now() - new Date(envInfo.startTime).getTime();
      
      writeFileSync(envFile, JSON.stringify(envInfo, null, 2));
      
      console.log(`   Duration: ${(envInfo.duration / 1000).toFixed(2)}s`);
    } catch {
      // Non-fatal
    }
  }

  console.log('\n✅ Global Teardown Complete\n');
}

export default globalTeardown;



