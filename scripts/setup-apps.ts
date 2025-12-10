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

async function ensureCorrectBranch(appPath: string, branch: string): Promise<void> {
  const currentBranch = await $`git -C ${appPath} branch --show-current`.nothrow().quiet();
  const current = currentBranch.stdout.toString().trim();
  
  if (current !== branch) {
    // Try to checkout the correct branch
    const checkoutResult = await $`git -C ${appPath} checkout ${branch}`.nothrow().quiet();
    if (checkoutResult.exitCode !== 0) {
      // Branch might not exist locally, try fetching and checking out
      await $`git -C ${appPath} fetch origin ${branch}`.nothrow().quiet();
      await $`git -C ${appPath} checkout -b ${branch} origin/${branch}`.nothrow().quiet();
    }
  }
}

async function installDependencies(appPath: string, appName: string): Promise<boolean> {
  // Check if package.json exists
  if (!existsSync(join(appPath, 'package.json'))) {
    return true; // No dependencies to install
  }
  
  console.log(`   📦 Installing ${appName} dependencies...`);
  const result = await $`cd ${appPath} && bun install --frozen-lockfile`.nothrow().quiet();
  
  if (result.exitCode !== 0) {
    // Try without frozen lockfile
    const retryResult = await $`cd ${appPath} && bun install`.nothrow().quiet();
    return retryResult.exitCode === 0;
  }
  
  return true;
}

async function cloneVendorApp(app: VendorAppConfig): Promise<'cloned' | 'exists' | 'skipped'> {
  const fullPath = join(process.cwd(), app.path);
  
  // Already exists
  if (existsSync(fullPath) && existsSync(join(fullPath, '.git'))) {
    // Ensure on correct branch
    await ensureCorrectBranch(fullPath, app.branch);
    return 'exists';
  }
  
  // Check access for private repos
  if (app.private) {
    const hasAccess = await checkGitAccess(app.url);
    if (!hasAccess) {
      console.log(`   ⏭️  ${app.name} - no access (private repo, skipping)`);
      return 'skipped';
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
      // Ensure on correct branch
      await ensureCorrectBranch(fullPath, app.branch);
      console.log(`   ✅ ${app.name} initialized (submodule)`);
      return 'cloned';
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
    return 'cloned';
  }
  
  const stderr = cloneResult.stderr.toString();
  if (stderr.includes('Permission denied') || stderr.includes('Repository not found')) {
    console.log(`   ⏭️  ${app.name} - permission denied (skipping)`);
  } else {
    console.log(`   ⚠️  ${app.name} - clone failed: ${stderr.split('\n')[0]}`);
  }
  
  return 'skipped';
}

async function setupVendorApps(): Promise<string[]> {
  console.log('📦 Setting up vendor apps...\n');
  
  const config = loadVendorAppsConfig();
  
  if (config.apps.length === 0) {
    console.log('   ℹ️  No vendor apps configured\n');
    return [];
  }
  
  console.log(`   Found ${config.apps.length} vendor app(s) in config\n`);
  
  let cloned = 0;
  let skipped = 0;
  let existing = 0;
  const newlyCloned: string[] = [];
  
  for (const app of config.apps) {
    const result = await cloneVendorApp(app);
    
    switch (result) {
      case 'cloned':
        cloned++;
        newlyCloned.push(app.path);
        break;
      case 'exists':
        console.log(`   ✅ ${app.name} already exists`);
        existing++;
        break;
      case 'skipped':
        skipped++;
        break;
    }
  }
  
  console.log('');
  console.log(`   📊 Summary: ${existing} existing, ${cloned} cloned, ${skipped} skipped\n`);
  
  return newlyCloned;
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
  const newlyCloned = await setupVendorApps();
  
  // 3. Install dependencies for newly cloned vendor apps
  if (newlyCloned.length > 0) {
    console.log('📦 Installing dependencies for newly cloned apps...\n');
    
    for (const appPath of newlyCloned) {
      const appName = appPath.split('/').pop() || appPath;
      const fullPath = join(process.cwd(), appPath);
      
      const success = await installDependencies(fullPath, appName);
      if (success) {
        console.log(`   ✅ ${appName} dependencies installed`);
      } else {
        console.log(`   ⚠️  ${appName} dependency install failed (run 'bun install' in ${appPath})`);
      }
    }
    console.log('');
  }
  
  // 4. Discover and report on vendor apps with manifests
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

  // 5. Check core dependencies
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

  // 6. Setup Synpress cache directory
  console.log('🧪 Setting up test infrastructure...');
  
  if (!existsSync(SYNPRESS_CACHE_DIR)) {
    mkdirSync(SYNPRESS_CACHE_DIR, { recursive: true });
    console.log('   ✅ Created synpress cache directory\n');
  } else {
    console.log('   ✅ Synpress cache directory exists\n');
  }

  // 7. Install Playwright browsers (needed for Synpress)
  console.log('   🎭 Installing Playwright browsers...');
  const playwrightResult = await $`bunx playwright install chromium`.nothrow().quiet();
  
  if (playwrightResult.exitCode === 0) {
    console.log('   ✅ Playwright browsers installed\n');
  } else {
    console.log('   ⚠️  Could not install Playwright browsers (run: bunx playwright install)\n');
  }

  // 8. Summary
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
