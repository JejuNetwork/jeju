#!/usr/bin/env bun
/**
 * Setup Script - Initializes workspace apps, vendor apps, and test infrastructure
 * Runs after bun install (postinstall hook)
 * 
 * This script is safe to fail - it's a best-effort setup
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';
import { discoverVendorApps } from './shared/discover-apps';

const SYNPRESS_CACHE_DIR = '.synpress-cache';

interface VendorAppConfig {
  name: string;
  url: string;
  path: string;
  description?: string;
  private: boolean;
  optional: boolean;
  branch: string;
}

interface VendorAppsConfig {
  apps: VendorAppConfig[];
}

function loadVendorAppsConfig(): VendorAppsConfig {
  const configPath = join(process.cwd(), 'packages/config/vendor-apps.json');
  if (!existsSync(configPath)) {
    return { apps: [] };
  }
  const content = readFileSync(configPath, 'utf-8');
  return JSON.parse(content);
}

async function checkGitAccess(url: string): Promise<boolean> {
  // Use git ls-remote to check access to the specific repo (fast, no clone)
  const result = await $`git ls-remote --exit-code ${url} HEAD`.nothrow().quiet();
  return result.exitCode === 0;
}

async function cloneVendorApp(app: VendorAppConfig): Promise<boolean> {
  const fullPath = join(process.cwd(), app.path);
  
  // Already exists
  if (existsSync(fullPath) && existsSync(join(fullPath, '.git'))) {
    console.log(`   ✅ ${app.name} already exists`);
    return true;
  }
  
  // Check access for private repos
  if (app.private) {
    const hasAccess = await checkGitAccess(app.url);
    if (!hasAccess) {
      console.log(`   ⏭️  ${app.name} - no access (private repo, skipping)`);
      return false;
    }
  }
  
  // Try git submodule first
  console.log(`   📥 Cloning ${app.name}...`);
  
  // Check if already registered as submodule
  const gitmodulesPath = join(process.cwd(), '.gitmodules');
  const isSubmodule = existsSync(gitmodulesPath) && 
    readFileSync(gitmodulesPath, 'utf-8').includes(`path = ${app.path}`);
  
  if (isSubmodule) {
    // Init existing submodule
    const result = await $`git submodule update --init --recursive ${app.path}`.nothrow().quiet();
    if (result.exitCode === 0) {
      console.log(`   ✅ ${app.name} initialized (submodule)`);
      return true;
    }
  }
  
  // Clone directly if not a submodule
  const parentDir = join(fullPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  
  const cloneResult = await $`git clone --depth 1 --branch ${app.branch} ${app.url} ${fullPath}`.nothrow().quiet();
  
  if (cloneResult.exitCode === 0) {
    console.log(`   ✅ ${app.name} cloned`);
    return true;
  }
  
  const stderr = cloneResult.stderr.toString();
  if (stderr.includes('Permission denied') || stderr.includes('Repository not found')) {
    console.log(`   ⏭️  ${app.name} - permission denied (skipping)`);
  } else {
    console.log(`   ⚠️  ${app.name} - clone failed: ${stderr.split('\n')[0]}`);
  }
  
  return false;
}

async function setupVendorApps(): Promise<void> {
  console.log('📦 Setting up vendor apps...\n');
  
  const config = loadVendorAppsConfig();
  
  if (config.apps.length === 0) {
    console.log('   ℹ️  No vendor apps configured\n');
    return;
  }
  
  console.log(`   Found ${config.apps.length} vendor app(s) in config\n`);
  
  let cloned = 0;
  let skipped = 0;
  let existing = 0;
  
  for (const app of config.apps) {
    const fullPath = join(process.cwd(), app.path);
    const alreadyExists = existsSync(fullPath) && existsSync(join(fullPath, '.git'));
    
    if (alreadyExists) {
      console.log(`   ✅ ${app.name} already exists`);
      existing++;
      continue;
    }
    
    const success = await cloneVendorApp(app);
    if (success) {
      cloned++;
    } else {
      skipped++;
    }
  }
  
  console.log('');
  console.log(`   📊 Summary: ${existing} existing, ${cloned} cloned, ${skipped} skipped\n`);
}

async function main() {
  console.log('🔧 Setting up Jeju workspace...\n');

  // 1. Initialize git submodules (contract libs)
  console.log('📚 Initializing contract libraries...\n');
  
  const contractLibsResult = await $`git submodule update --init --recursive packages/contracts/lib/`.nothrow().quiet();
  
  if (contractLibsResult.exitCode === 0) {
    console.log('   ✅ Contract libraries synced\n');
  } else {
    console.log('   ⚠️  Could not sync contract libraries (may not be in git repo)\n');
  }

  // 2. Setup vendor apps (check access and clone if available)
  await setupVendorApps();
  
  // 3. Discover and report on vendor apps with manifests
  console.log('🎮 Discovering vendor apps...\n');
  const vendorApps = discoverVendorApps();
  
  if (vendorApps.length === 0) {
    console.log('   ℹ️  No vendor apps with jeju-manifest.json found\n');
  } else {
    console.log(`   Found ${vendorApps.length} vendor app(s) with jeju-manifest.json:`);
    for (const app of vendorApps) {
      const status = app.exists ? '✅' : '⚠️';
      console.log(`   ${status} ${app.manifest.displayName || app.name}`);
    }
    console.log('');
  }

  // 4. Check core dependencies
  console.log('🔍 Checking core dependencies...');
  
  if (existsSync('packages/contracts')) {
    console.log('   ✅ Contracts found');
  }
  
  if (existsSync('packages/config')) {
    console.log('   ✅ Config found');
  }
  
  if (existsSync('packages/tests')) {
    console.log('   ✅ Test utilities found');
  }
  
  console.log('');

  // 5. Setup Synpress cache directory
  console.log('🧪 Setting up test infrastructure...');
  
  if (!existsSync(SYNPRESS_CACHE_DIR)) {
    mkdirSync(SYNPRESS_CACHE_DIR, { recursive: true });
    console.log('   ✅ Created synpress cache directory\n');
  } else {
    console.log('   ✅ Synpress cache directory exists\n');
  }

  // 6. Install Playwright browsers (needed for Synpress)
  console.log('   🎭 Installing Playwright browsers...');
  const playwrightResult = await $`bunx playwright install chromium`.nothrow().quiet();
  
  if (playwrightResult.exitCode === 0) {
    console.log('   ✅ Playwright browsers installed\n');
  } else {
    console.log('   ⚠️  Could not install Playwright browsers (run: bunx playwright install)\n');
  }

  // 7. Summary
  console.log('✅ Workspace setup complete\n');
  console.log('Next steps:');
  console.log('  • Start development: bun run dev');
  console.log('  • Run all tests: bun test');
  console.log('  • Run wallet tests: bun run test:wallet');
  console.log('  • Build synpress cache: bun run synpress:cache\n');
}

main().catch((err) => {
  console.error('⚠️  Setup warnings:', err.message);
  // Exit with 0 to not break install
  process.exit(0);
});
