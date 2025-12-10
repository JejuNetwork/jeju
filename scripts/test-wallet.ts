#!/usr/bin/env bun
/**
 * Wallet Test Runner
 * Runs Synpress wallet tests across all apps with unified configuration
 * 
 * Usage:
 *   bun run test:wallet                # Run all wallet tests
 *   bun run test:wallet bazaar         # Run bazaar wallet tests
 *   bun run test:wallet --list         # List available apps
 *   bun run test:wallet --vendor       # Include vendor examples
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { Logger } from './shared/logger';

const logger = new Logger({ prefix: 'wallet-test' });

interface WalletTestApp {
  name: string;
  path: string;
  configFile: string;
  testDir: string;
  type: 'app' | 'vendor';
}

// Core apps with wallet tests
const CORE_WALLET_APPS: WalletTestApp[] = [
  {
    name: 'Bazaar',
    path: 'apps/bazaar',
    configFile: 'synpress.config.ts',
    testDir: 'tests/wallet',
    type: 'app',
  },
  {
    name: 'Storage',
    path: 'apps/storage/app',
    configFile: 'synpress.config.ts',
    testDir: 'tests/wallet',
    type: 'app',
  },
  {
    name: 'Compute',
    path: 'apps/compute',
    configFile: 'synpress.config.ts',
    testDir: 'tests/synpress',
    type: 'app',
  },
  {
    name: 'Gateway',
    path: 'apps/gateway',
    configFile: 'synpress.config.ts',
    testDir: 'tests/e2e-synpress',
    type: 'app',
  },
  {
    name: 'Intents Viewer',
    path: 'apps/intents/viewer',
    configFile: 'playwright.config.ts',
    testDir: 'tests',
    type: 'app',
  },
];

// Discover vendor examples with synpress configs
function discoverVendorWalletApps(): WalletTestApp[] {
  const vendorDir = 'vendor_examples';
  if (!existsSync(vendorDir)) return [];
  
  const apps: WalletTestApp[] = [];
  
  function checkDir(dir: string, name: string) {
    const configPath = `${dir}/synpress.config.ts`;
    if (existsSync(configPath)) {
      // Find test directory
      const possibleTestDirs = ['tests/synpress', 'tests/wallet', 'tests/e2e-wallet', 'tests/e2e'];
      const testDir = possibleTestDirs.find(d => existsSync(`${dir}/${d}`)) || 'tests';
      
      apps.push({
        name: `Vendor: ${name}`,
        path: dir,
        configFile: 'synpress.config.ts',
        testDir,
        type: 'vendor',
      });
    }
  }
  
  const vendorDirs = readdirSync(vendorDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const vendorName of vendorDirs) {
    checkDir(`${vendorDir}/${vendorName}`, vendorName);
    
    // Check subdirectories (e.g., miniapps/*)
    const subDir = `${vendorDir}/${vendorName}`;
    if (existsSync(subDir)) {
      const subDirs = readdirSync(subDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      
      for (const subName of subDirs) {
        checkDir(`${subDir}/${subName}`, `${vendorName}/${subName}`);
      }
    }
  }
  
  return apps;
}

const WALLET_TEST_APPS = CORE_WALLET_APPS;

async function runWalletTests() {
  logger.info('');
  logger.info('╔════════════════════════════════════════════════════════════════════╗');
  logger.info('║                 SYNPRESS WALLET TEST SUITE                         ║');
  logger.info('╚════════════════════════════════════════════════════════════════════╝');
  logger.info('');

  const appsToTest = getAppsToTest();

  if (appsToTest.length === 0) {
    logger.warn('No apps with wallet tests found');
    logger.info('Use --list to see available apps');
    process.exit(0);
  }

  const coreApps = appsToTest.filter(a => a.type === 'app');
  const vendorApps = appsToTest.filter(a => a.type === 'vendor');

  logger.info(`Found ${appsToTest.length} app(s) with wallet tests:`);
  if (coreApps.length > 0) {
    logger.info('  Core Apps:');
    coreApps.forEach((app) => logger.info(`    • ${app.name} (${app.path})`));
  }
  if (vendorApps.length > 0) {
    logger.info('  Vendor Apps:');
    vendorApps.forEach((app) => logger.info(`    • ${app.name} (${app.path})`));
  }
  logger.info('');

  const results: { name: string; passed: boolean; duration: number }[] = [];

  for (const app of appsToTest) {
    const startTime = Date.now();

    logger.info(`\n${'─'.repeat(60)}`);
    logger.info(`🧪 Testing: ${app.name}`);
    logger.info('─'.repeat(60));

    const passed = await runAppWalletTests(app);
    const duration = Date.now() - startTime;

    results.push({ name: app.name, passed, duration });
  }

  printSummary(results);

  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

async function runAppWalletTests(app: WalletTestApp): Promise<boolean> {
  return new Promise((resolve) => {
    const test = spawn(
      'bunx',
      ['playwright', 'test', '--config', app.configFile, '--reporter=list'],
      {
        cwd: app.path,
        stdio: 'inherit',
        env: {
          ...process.env,
          SYNPRESS_CACHE_DIR: '../../.synpress-cache',
        },
      }
    );

    test.on('close', (code) => {
      resolve(code === 0);
    });

    test.on('error', (error) => {
      logger.error(`Test error: ${error.message}`);
      resolve(false);
    });
  });
}

function printSummary(
  results: { name: string; passed: boolean; duration: number }[]
) {
  logger.info('\n' + '═'.repeat(60));
  logger.info('📊 Wallet Test Results');
  logger.info('═'.repeat(60) + '\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  results.forEach((result) => {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';

    logger.info(
      `${color}${icon}${reset} ${result.name.padEnd(30)} ${(result.duration / 1000).toFixed(2)}s`
    );
  });

  logger.info('\n' + '-'.repeat(60));
  logger.info(`Total: ${total} apps`);
  logger.info(`${passed} passed, ${failed} failed`);
  logger.info(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  logger.info('-'.repeat(60) + '\n');

  if (failed === 0) {
    logger.success('🎉 All wallet tests passed!');
  } else {
    logger.warn(`⚠️  ${failed} app(s) failed wallet tests`);
  }
}

// Parse CLI args
const args = process.argv.slice(2);
const includeVendor = args.includes('--vendor');
const showList = args.includes('--list');
const specificApp = args.find(a => !a.startsWith('--'));

// Build list of apps to test
function getAppsToTest(): WalletTestApp[] {
  let apps = [...WALLET_TEST_APPS];
  
  if (includeVendor) {
    apps = [...apps, ...discoverVendorWalletApps()];
  }
  
  // Filter to apps that actually exist
  return apps.filter((app) => {
    const configPath = `${app.path}/${app.configFile}`;
    const testPath = `${app.path}/${app.testDir}`;
    return existsSync(configPath) && existsSync(testPath);
  });
}

if (showList) {
  logger.info('');
  logger.info('╔════════════════════════════════════════════════════════════════════╗');
  logger.info('║                  AVAILABLE WALLET TEST APPS                        ║');
  logger.info('╚════════════════════════════════════════════════════════════════════╝');
  logger.info('');
  
  logger.info('Core Apps:');
  CORE_WALLET_APPS.forEach((a) => {
    const exists = existsSync(`${a.path}/${a.configFile}`);
    const icon = exists ? '✅' : '⏭️';
    logger.info(`  ${icon} ${a.name.padEnd(25)} ${a.path}`);
  });
  
  const vendorApps = discoverVendorWalletApps();
  if (vendorApps.length > 0) {
    logger.info('');
    logger.info('Vendor Apps (use --vendor to include):');
    vendorApps.forEach((a) => {
      logger.info(`  ✅ ${a.name.padEnd(25)} ${a.path}`);
    });
  }
  
  logger.info('');
  logger.info('Usage:');
  logger.info('  bun run test:wallet                # Test all core apps');
  logger.info('  bun run test:wallet --vendor       # Test all including vendor');
  logger.info('  bun run test:wallet bazaar         # Test specific app');
  logger.info('  bun run test:wallet --list         # Show this list');
  logger.info('');
  
  process.exit(0);
}

if (specificApp) {
  const allApps = [...WALLET_TEST_APPS, ...discoverVendorWalletApps()];
  const app = allApps.find(
    (a) => a.name.toLowerCase().includes(specificApp.toLowerCase()) ||
           a.path.toLowerCase().includes(specificApp.toLowerCase())
  );

  if (!app) {
    logger.error(`Unknown app: ${specificApp}`);
    logger.info('Available apps:');
    allApps.forEach((a) => logger.info(`  • ${a.name} (${a.path})`));
    logger.info('');
    logger.info('Use --list to see all available apps');
    process.exit(1);
  }

  logger.info(`Running wallet tests for ${app.name}...\n`);
  runAppWalletTests(app).then((passed) => {
    process.exit(passed ? 0 : 1);
  });
} else {
  runWalletTests();
}
