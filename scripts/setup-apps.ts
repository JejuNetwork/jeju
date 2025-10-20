#!/usr/bin/env bun
/**
 * Setup Script - Initializes workspace apps and vendor apps
 * Runs after bun install (postinstall hook)
 * 
 * This script is safe to fail - it's a best-effort setup
 */

import { existsSync } from 'fs';
import { $ } from 'bun';
import { discoverVendorApps } from './shared/discover-apps';

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
  
  if (existsSync('shared')) {
    console.log('   ✅ Shared types found');
  }
  
  console.log('');

  // 3. Summary
  console.log('✅ Workspace setup complete!\n');
  console.log('Next steps:');
  console.log('  • List vendor apps: bun run vendor:list');
  console.log('  • Start development: bun run dev');
  console.log('  • Migrate apps to vendor: bun run vendor:migrate\n');
}

main().catch((err) => {
  console.error('⚠️  Setup warnings:', err.message);
  // Exit with 0 to not break install
  process.exit(0);
});
