#!/usr/bin/env bun
/**
 * Setup Script - Initializes workspace apps, vendor apps, and test infrastructure
 * Runs after bun install (postinstall hook)
 * 
 * This script is safe to fail - it's a best-effort setup
 */

import { existsSync, mkdirSync } from 'fs';
import { $ } from 'bun';
import { discoverVendorApps } from './shared/discover-apps';

const SYNPRESS_CACHE_DIR = '.synpress-cache';

async function main() {
  console.log('🔧 Setting up Jeju workspace...\n');

  // 1. Initialize git submodules (vendor apps + contract libs)
  console.log('📦 Initializing git submodules...\n');
  
  // 1a. Contracts library dependencies (Foundry libs: forge-std, OpenZeppelin, etc.)
  console.log('   📚 Syncing contract libraries (contracts/lib/)...');
  const contractLibsResult = await $`git submodule update --init --recursive contracts/lib/`.nothrow().quiet();
  
  if (contractLibsResult.exitCode === 0) {
    console.log('   ✅ Contract libraries synced\n');
  } else {
    console.log('   ⚠️  Could not sync contract libraries (may not be in git repo)\n');
  }
  
  // 1b. Vendor apps
  console.log('   🎮 Initializing vendor apps...');
  const vendorApps = discoverVendorApps();
  
  if (vendorApps.length === 0) {
    console.log('   ℹ️  No vendor apps configured - skipping\n');
  } else {
    console.log(`   Found ${vendorApps.length} vendor app(s) with jeju-manifest.json`);
    
    // Try to init submodules
    const result = await $`git submodule update --init --recursive vendor/`.nothrow().quiet();
    
    if (result.exitCode === 0) {
      console.log('   ✅ Vendor apps initialized\n');
    } else {
      console.log('   ⚠️  Could not initialize vendor apps (may not be git submodules yet)\n');
    }
  }

  // 2. Check core dependencies
  console.log('🔍 Checking core dependencies...');
  
  if (existsSync('contracts')) {
    console.log('   ✅ Contracts found');
  }
  
  if (existsSync('config')) {
    console.log('   ✅ Config found');
  }
  
  if (existsSync('packages/tests')) {
    console.log('   ✅ Test utilities found');
  }
  
  console.log('');

  // 3. Setup Synpress cache directory
  console.log('🧪 Setting up test infrastructure...');
  
  if (!existsSync(SYNPRESS_CACHE_DIR)) {
    mkdirSync(SYNPRESS_CACHE_DIR, { recursive: true });
    console.log('   ✅ Created synpress cache directory\n');
  } else {
    console.log('   ✅ Synpress cache directory exists\n');
  }

  // 4. Install Playwright browsers (needed for Synpress)
  console.log('   🎭 Installing Playwright browsers...');
  const playwrightResult = await $`bunx playwright install chromium`.nothrow().quiet();
  
  if (playwrightResult.exitCode === 0) {
    console.log('   ✅ Playwright browsers installed\n');
  } else {
    console.log('   ⚠️  Could not install Playwright browsers (run: bunx playwright install)\n');
  }

  // 5. Summary
  console.log('✅ Workspace setup complete!\n');
  console.log('Next steps:');
  console.log('  • Start development: bun run dev');
  console.log('  • Run all tests: bun test');
  console.log('  • Run wallet tests: bun run test:wallet (in any app directory)');
  console.log('  • Build synpress cache: bun run synpress:cache (in packages/tests)\n');
}

main().catch((err) => {
  console.error('⚠️  Setup warnings:', err.message);
  // Exit with 0 to not break install
  process.exit(0);
});
