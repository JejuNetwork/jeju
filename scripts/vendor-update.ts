#!/usr/bin/env bun
/**
 * Update vendor apps - pulls latest changes from remote
 * Run: bun run vendor:update
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

const VENDOR_DIR = join(process.cwd(), 'vendor');

interface UpdateResult {
  name: string;
  status: 'updated' | 'up-to-date' | 'error' | 'skipped';
  message?: string;
}

async function updateVendorApp(appPath: string): Promise<UpdateResult> {
  const name = appPath.split('/').pop() || appPath;
  
  // Check if it's a git repo
  if (!existsSync(join(appPath, '.git'))) {
    return { name, status: 'skipped', message: 'not a git repo' };
  }

  // Fetch and check for updates
  const fetchResult = await $`git -C ${appPath} fetch origin`.nothrow().quiet();
  if (fetchResult.exitCode !== 0) {
    return { name, status: 'error', message: 'fetch failed' };
  }

  // Check if there are updates
  const statusResult = await $`git -C ${appPath} status -uno`.quiet();
  const statusOutput = statusResult.stdout.toString();

  if (statusOutput.includes('Your branch is behind')) {
    // Pull updates
    const pullResult = await $`git -C ${appPath} pull --ff-only`.nothrow().quiet();
    if (pullResult.exitCode === 0) {
      return { name, status: 'updated' };
    }
    return { name, status: 'error', message: 'pull failed (may have local changes)' };
  }

  return { name, status: 'up-to-date' };
}

async function main() {
  console.log('🔄 Updating vendor apps...\n');

  if (!existsSync(VENDOR_DIR)) {
    console.log('   ℹ️  No vendor directory found\n');
    return;
  }

  const entries = readdirSync(VENDOR_DIR);
  const results: UpdateResult[] = [];

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'README.md') continue;

    const appPath = join(VENDOR_DIR, entry);
    if (!statSync(appPath).isDirectory()) continue;

    process.stdout.write(`   ${entry}... `);
    const result = await updateVendorApp(appPath);
    results.push(result);

    switch (result.status) {
      case 'updated':
        console.log('✅ updated');
        break;
      case 'up-to-date':
        console.log('✓ up-to-date');
        break;
      case 'skipped':
        console.log(`⏭️  ${result.message}`);
        break;
      case 'error':
        console.log(`⚠️  ${result.message}`);
        break;
    }
  }

  const updated = results.filter(r => r.status === 'updated').length;
  const upToDate = results.filter(r => r.status === 'up-to-date').length;
  const errors = results.filter(r => r.status === 'error').length;

  console.log('');
  console.log(`   📊 Summary: ${updated} updated, ${upToDate} up-to-date, ${errors} errors\n`);

  if (updated > 0) {
    console.log('   💡 Run `bun install` to install any new dependencies\n');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
