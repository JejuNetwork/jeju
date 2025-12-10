#!/usr/bin/env bun
/**
 * Jeju Master Test Runner
 * 
 * Runs all tests across the entire project in proper order:
 * 1. Core Setup & Utilities
 * 2. Packages (config, types, contracts)
 * 3. Apps (one by one)
 * 4. Vendor Apps (one by one)
 * 5. Wallet/E2E Tests (optional, with --wallet flag)
 * 
 * Usage:
 *   bun test                    # Run all tests
 *   bun test --wallet           # Include wallet/E2E tests
 *   bun test --phase=apps       # Run only apps phase
 *   bun test --app=bazaar       # Run tests for specific app
 *   bun test --package=config   # Run tests for specific package
 *   bun test --help             # Show help
 */

import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { Logger } from './shared/logger';

const logger = new Logger({ prefix: 'test' });

// ============================================================================
// Configuration
// ============================================================================

interface TestSuite {
  name: string;
  command: string;
  cwd?: string;
  required?: boolean;
  env?: Record<string, string>;
  skip?: () => boolean;
}

interface TestPhase {
  name: string;
  description: string;
  suites: TestSuite[];
}

// Phase 1: Core Setup & Utilities
const CORE_SETUP_SUITES: TestSuite[] = [
  {
    name: 'Logger',
    command: 'bun test scripts/shared/logger.test.ts',
    required: false,
  },
  {
    name: 'Format',
    command: 'bun test scripts/shared/format.test.ts',
    required: false,
  },
  {
    name: 'RPC Utilities',
    command: 'bun test scripts/shared/rpc.test.ts',
    required: false,
  },
  {
    name: 'Notifications',
    command: 'bun test scripts/shared/notifications.test.ts',
    required: false,
  },
];

// Phase 2: Packages
const PACKAGES_SUITES: TestSuite[] = [
  {
    name: 'Config Package',
    command: 'bun test index.test.ts',
    cwd: 'packages/config',
    required: false,
  },
  {
    name: 'Contracts (Core)',
    command: 'forge test --match-path test/BanManager.t.sol -vv',
    cwd: 'packages/contracts',
    required: false,
    skip: () => !existsSync('packages/contracts/foundry.toml'),
  },
  {
    name: 'Contracts (Compute)',
    command: 'forge test --match-path test/compute/*.t.sol -vv',
    cwd: 'packages/contracts',
    required: false,
    skip: () => !existsSync('packages/contracts/foundry.toml'),
  },
  {
    name: 'Contracts (Moderation)',
    command: 'forge test --match-path test/Moderation*.t.sol -vv',
    cwd: 'packages/contracts',
    required: false,
    skip: () => !existsSync('packages/contracts/foundry.toml'),
  },
];

// Phase 3: Apps - dynamically discovered
function discoverAppTests(): TestSuite[] {
  const appsDir = 'apps';
  if (!existsSync(appsDir)) return [];
  
  const apps: TestSuite[] = [];
  const appDirs = readdirSync(appsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const appName of appDirs) {
    const appPath = `${appsDir}/${appName}`;
    const packagePath = `${appPath}/package.json`;
    
    if (existsSync(packagePath)) {
      const pkg = require(`../${packagePath}`);
      if (pkg.scripts?.test) {
        apps.push({
          name: `App: ${appName}`,
          command: 'bun run test',
          cwd: appPath,
          required: false,
        });
      }
    }
    
    // Check for nested apps (e.g., apps/storage/app)
    const nestedDirs = existsSync(appPath) ? 
      readdirSync(appPath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name) : [];
    
    for (const nested of nestedDirs) {
      const nestedPath = `${appPath}/${nested}`;
      const nestedPackage = `${nestedPath}/package.json`;
      if (existsSync(nestedPackage)) {
        const pkg = require(`../${nestedPackage}`);
        if (pkg.scripts?.test) {
          apps.push({
            name: `App: ${appName}/${nested}`,
            command: 'bun run test',
            cwd: nestedPath,
            required: false,
          });
        }
      }
    }
  }
  
  return apps;
}

// Phase 4: Vendor Examples - dynamically discovered
function discoverVendorTests(): TestSuite[] {
  const vendorDir = 'vendor_examples';
  if (!existsSync(vendorDir)) return [];
  
  const vendors: TestSuite[] = [];
  const vendorDirs = readdirSync(vendorDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const vendorName of vendorDirs) {
    const vendorPath = `${vendorDir}/${vendorName}`;
    const packagePath = `${vendorPath}/package.json`;
    
    if (existsSync(packagePath)) {
      const pkg = require(`../${packagePath}`);
      if (pkg.scripts?.test) {
        vendors.push({
          name: `Vendor: ${vendorName}`,
          command: 'bun run test',
          cwd: vendorPath,
          required: false,
        });
      }
    }
  }
  
  return vendors;
}

// Phase 5: Wallet/E2E Tests
const WALLET_SUITES: TestSuite[] = [
  {
    name: 'Bazaar Wallet',
    command: 'bunx playwright test --config synpress.config.ts --reporter=list',
    cwd: 'apps/bazaar',
    required: false,
    env: { SYNPRESS_CACHE_DIR: '../../.synpress-cache' },
    skip: () => !existsSync('apps/bazaar/synpress.config.ts'),
  },
  {
    name: 'Storage Wallet',
    command: 'bunx playwright test --config synpress.config.ts --reporter=list',
    cwd: 'apps/storage/app',
    required: false,
    env: { SYNPRESS_CACHE_DIR: '../../../.synpress-cache' },
    skip: () => !existsSync('apps/storage/app/synpress.config.ts'),
  },
  {
    name: 'Compute Wallet',
    command: 'bunx playwright test --config synpress.config.ts --reporter=list',
    cwd: 'apps/compute',
    required: false,
    env: { SYNPRESS_CACHE_DIR: '../../.synpress-cache' },
    skip: () => !existsSync('apps/compute/synpress.config.ts'),
  },
  {
    name: 'Gateway Wallet',
    command: 'bunx playwright test --config synpress.config.ts --reporter=list',
    cwd: 'apps/gateway',
    required: false,
    env: { SYNPRESS_CACHE_DIR: '../../.synpress-cache' },
    skip: () => !existsSync('apps/gateway/synpress.config.ts'),
  },
];

// ============================================================================
// Test Phases
// ============================================================================

function getTestPhases(options: TestOptions): TestPhase[] {
  const phases: TestPhase[] = [];
  
  // If specific app/vendor filter is set, skip core/packages phases
  const hasFilter = options.app || options.vendor;
  
  if (!hasFilter && (!options.phase || options.phase === 'core')) {
    phases.push({
      name: 'CORE',
      description: 'Core Setup & Utilities',
      suites: CORE_SETUP_SUITES,
    });
  }
  
  if (!hasFilter && (!options.phase || options.phase === 'packages')) {
    phases.push({
      name: 'PACKAGES',
      description: 'Package Tests (config, contracts)',
      suites: PACKAGES_SUITES,
    });
  }
  
  if (options.app || (!options.phase || options.phase === 'apps')) {
    const appSuites = options.app 
      ? discoverAppTests().filter(s => s.name.toLowerCase().includes(options.app!.toLowerCase()))
      : discoverAppTests();
    
    if (appSuites.length > 0) {
      phases.push({
        name: 'APPS',
        description: 'Application Tests',
        suites: appSuites,
      });
    }
  }
  
  if (options.vendor || (!options.app && (!options.phase || options.phase === 'vendor'))) {
    const vendorSuites = options.vendor
      ? discoverVendorTests().filter(s => s.name.toLowerCase().includes(options.vendor!.toLowerCase()))
      : discoverVendorTests();
    
    if (vendorSuites.length > 0) {
      phases.push({
        name: 'VENDOR',
        description: 'Vendor App Tests',
        suites: vendorSuites,
      });
    }
  }
  
  if (options.wallet && (!options.phase || options.phase === 'wallet')) {
    phases.push({
      name: 'WALLET',
      description: 'Wallet/E2E Tests (Synpress)',
      suites: WALLET_SUITES,
    });
  }
  
  return phases;
}

// ============================================================================
// CLI Options
// ============================================================================

interface TestOptions {
  wallet: boolean;
  phase?: string;
  app?: string;
  package?: string;
  vendor?: string;
  help: boolean;
}

function parseArgs(): TestOptions {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    wallet: false,
    help: false,
  };
  
  for (const arg of args) {
    if (arg === '--wallet') options.wallet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--phase=')) options.phase = arg.split('=')[1];
    else if (arg.startsWith('--app=')) options.app = arg.split('=')[1];
    else if (arg.startsWith('--package=')) options.package = arg.split('=')[1];
    else if (arg.startsWith('--vendor=')) options.vendor = arg.split('=')[1];
  }
  
  return options;
}

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                    JEJU TEST RUNNER                                ║
╚════════════════════════════════════════════════════════════════════╝

USAGE:
  bun test [options]

OPTIONS:
  --help, -h            Show this help message
  --wallet              Include wallet/E2E tests (Synpress)
  --phase=<phase>       Run only specific phase:
                        core, packages, apps, vendor, wallet

FILTERING:
  --app=<name>          Run tests for specific app (e.g., --app=bazaar)
  --package=<name>      Run tests for specific package (e.g., --package=config)
  --vendor=<name>       Run tests for specific vendor (e.g., --vendor=leaderboard)

EXAMPLES:
  bun test                          Run all tests (no wallet)
  bun test --wallet                 Run all tests including wallet E2E
  bun test --phase=apps             Run only app tests
  bun test --app=bazaar             Run only bazaar app tests
  bun test --app=bazaar --wallet    Run bazaar tests + wallet tests
  bun test --vendor=leaderboard     Run leaderboard vendor tests

INDIVIDUAL TESTING:
  # Test a single package:
  cd packages/config && bun test

  # Test a single app:
  cd apps/bazaar && bun test

  # Test wallet for single app:
  cd apps/bazaar && bunx playwright test --config synpress.config.ts

  # Test a vendor example:
  cd vendor_examples/leaderboard && bun test

TEST PHASES (in order):
  1. CORE      - Shared utilities (logger, format, rpc)
  2. PACKAGES  - Package tests (config, contracts)
  3. APPS      - Application tests (bazaar, gateway, etc.)
  4. VENDOR    - Vendor example tests
  5. WALLET    - Synpress E2E tests (requires --wallet flag)
`);
}

// ============================================================================
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  phase: string;
  passed: boolean;
  duration: number;
  skipped: boolean;
}

async function runTestSuite(suite: TestSuite): Promise<{ passed: boolean; skipped: boolean }> {
  if (suite.skip?.()) {
    logger.warn(`  ⏭️  Skipped (missing dependencies)`);
    return { passed: true, skipped: true };
  }
  
  return new Promise((resolve) => {
    const [cmd, ...args] = suite.command.split(' ');
    
    const test = spawn(cmd, args, {
      cwd: suite.cwd || process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, ...suite.env },
    });
    
    test.on('close', (code) => {
      resolve({ passed: code === 0, skipped: false });
    });
    
    test.on('error', (error) => {
      logger.error(`  Error: ${error.message}`);
      resolve({ passed: false, skipped: false });
    });
  });
}

async function runPhase(phase: TestPhase): Promise<TestResult[]> {
  const results: TestResult[] = [];
  
  logger.info('');
  logger.info('╔' + '═'.repeat(68) + '╗');
  logger.info(`║  PHASE: ${phase.name.padEnd(57)} ║`);
  logger.info(`║  ${phase.description.padEnd(65)} ║`);
  logger.info('╚' + '═'.repeat(68) + '╝');
  logger.info('');
  
  if (phase.suites.length === 0) {
    logger.warn('  No tests found for this phase');
    return results;
  }
  
  for (const suite of phase.suites) {
    const startTime = Date.now();
    
    logger.info(`─── ${suite.name} ───`);
    logger.info(`    Command: ${suite.command}`);
    if (suite.cwd) logger.info(`    Directory: ${suite.cwd}`);
    logger.info('');
    
    const { passed, skipped } = await runTestSuite(suite);
    const duration = Date.now() - startTime;
    
    results.push({
      name: suite.name,
      phase: phase.name,
      passed,
      duration,
      skipped,
    });
    
    const icon = skipped ? '⏭️' : (passed ? '✅' : '❌');
    const status = skipped ? 'SKIPPED' : (passed ? 'PASSED' : 'FAILED');
    logger.info(`\n    ${icon} ${status} (${(duration / 1000).toFixed(2)}s)\n`);
    
    if (!passed && suite.required && !skipped) {
      logger.error(`\n❌ Required test failed: ${suite.name}`);
      logger.error('Aborting test run.\n');
      return results;
    }
  }
  
  return results;
}

function printSummary(results: TestResult[]) {
  logger.info('\n' + '═'.repeat(70));
  logger.info('                         TEST SUMMARY');
  logger.info('═'.repeat(70) + '\n');
  
  // Group by phase
  const byPhase = new Map<string, TestResult[]>();
  results.forEach(r => {
    if (!byPhase.has(r.phase)) byPhase.set(r.phase, []);
    byPhase.get(r.phase)!.push(r);
  });
  
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalDuration = 0;
  
  for (const [phase, phaseResults] of byPhase) {
    const passed = phaseResults.filter(r => r.passed && !r.skipped).length;
    const failed = phaseResults.filter(r => !r.passed).length;
    const skipped = phaseResults.filter(r => r.skipped).length;
    const duration = phaseResults.reduce((sum, r) => sum + r.duration, 0);
    
    totalPassed += passed;
    totalFailed += failed;
    totalSkipped += skipped;
    totalDuration += duration;
    
    logger.info(`${phase}:`);
    phaseResults.forEach(r => {
      const icon = r.skipped ? '⏭️' : (r.passed ? '✅' : '❌');
      const time = `${(r.duration / 1000).toFixed(2)}s`;
      logger.info(`  ${icon} ${r.name.padEnd(45)} ${time.padStart(8)}`);
    });
    logger.info('');
  }
  
  logger.info('─'.repeat(70));
  logger.info(`Total: ${results.length} suites`);
  logger.info(`  ✅ Passed:  ${totalPassed}`);
  logger.info(`  ❌ Failed:  ${totalFailed}`);
  logger.info(`  ⏭️  Skipped: ${totalSkipped}`);
  logger.info(`  ⏱️  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  logger.info('─'.repeat(70) + '\n');
  
  if (totalFailed === 0) {
    logger.success('🎉 All tests passed!');
  } else {
    logger.error(`❌ ${totalFailed} test(s) failed`);
  }
  
  // Print help for individual testing
  logger.info('\n' + '─'.repeat(70));
  logger.info('📖 To test individual components:');
  logger.info('   bun test --app=<name>      # Test specific app');
  logger.info('   bun test --package=<name>  # Test specific package');
  logger.info('   bun test --vendor=<name>   # Test specific vendor');
  logger.info('   bun test --help            # Show all options');
  logger.info('─'.repeat(70) + '\n');
}

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    printHelp();
    process.exit(0);
  }
  
  logger.info('');
  logger.info('╔════════════════════════════════════════════════════════════════════╗');
  logger.info('║                    JEJU PROJECT TEST SUITE                         ║');
  logger.info('╚════════════════════════════════════════════════════════════════════╝');
  logger.info('');
  
  const phases = getTestPhases(options);
  
  if (phases.length === 0) {
    logger.warn('No test phases selected');
    process.exit(0);
  }
  
  logger.info(`Running ${phases.length} phase(s): ${phases.map(p => p.name).join(' → ')}`);
  if (options.wallet) {
    logger.info('Wallet tests: ENABLED');
  }
  logger.info('');
  
  const allResults: TestResult[] = [];
  let aborted = false;
  
  for (const phase of phases) {
    const results = await runPhase(phase);
    allResults.push(...results);
    
    // Check if we hit a required failure
    const requiredFailed = results.some(r => !r.passed && !r.skipped && 
      phase.suites.find(s => s.name === r.name)?.required);
    
    if (requiredFailed) {
      aborted = true;
      break;
    }
  }
  
  printSummary(allResults);
  
  const failed = allResults.filter(r => !r.passed && !r.skipped).length;
  process.exit(failed > 0 || aborted ? 1 : 0);
}

main();
