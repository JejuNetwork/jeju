#!/usr/bin/env bun
/**
 * Jeju Full E2E Test Suite
 * 
 * Complete end-to-end testing that:
 * 1. Starts localnet (chain infrastructure)
 * 2. Deploys contracts if needed
 * 3. Starts all required services
 * 4. Runs E2E tests for each app
 * 5. Generates comprehensive reports
 * 
 * Usage:
 *   bun run test:e2e:full                  # Full suite
 *   bun run test:e2e:full --app=wallet     # Single app
 *   bun run test:e2e:full --ci             # CI mode (no TTY, JSON report)
 *   bun run test:e2e:full --parallel       # Parallel app tests (faster but needs more resources)
 *   bun run test:e2e:full --skip-deploy    # Skip contract deployment
 *   bun run test:e2e:full --keep-running   # Don't stop services after tests
 */

import { spawn, type Subprocess } from 'bun';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

interface CLIOptions {
  app?: string;
  ci: boolean;
  parallel: boolean;
  skipDeploy: boolean;
  skipPreflight: boolean;
  keepRunning: boolean;
  headed: boolean;
  verbose: boolean;
  help: boolean;
}

interface AppConfig {
  name: string;
  path: string;
  port: number;
  testDir: string;
  hasSynpress: boolean;
  dependencies: string[];
}

interface TestResult {
  app: string;
  passed: boolean;
  duration: number;
  tests: number;
  failed: number;
  skipped: number;
  error?: string;
}

const ROOT = process.cwd();
const REPORT_DIR = join(ROOT, '.jeju', 'e2e-reports');
const LOCALNET_RPC = 'http://localhost:9545';

// Apps to test in order (dependencies first)
const APP_ORDER = [
  'gateway',      // Core gateway - most critical
  'bazaar',       // DEX/trading
  'wallet',       // Wallet app
  'indexer',      // Blockchain indexer
  'storage',      // Decentralized storage
  'leaderboard',  // Reputation system
  'council',      // Governance
  'documentation', // Docs
];

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    ci: false,
    parallel: false,
    skipDeploy: false,
    skipPreflight: false,
    keepRunning: false,
    headed: false,
    verbose: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--ci') options.ci = true;
    else if (arg === '--parallel') options.parallel = true;
    else if (arg === '--skip-deploy') options.skipDeploy = true;
    else if (arg === '--skip-preflight') options.skipPreflight = true;
    else if (arg === '--keep-running') options.keepRunning = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--app=')) options.app = arg.split('=')[1];
  }

  return options;
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                 JEJU FULL E2E TEST ORCHESTRATOR                       ║
╚══════════════════════════════════════════════════════════════════════╝

USAGE:
  bun run test:e2e:full [options]

OPTIONS:
  --app=<name>       Run tests for a specific app only
  --ci               CI mode (JSON reports, no interactive output)
  --parallel         Run app tests in parallel (faster, needs more RAM)
  --skip-deploy      Skip contract deployment step
  --skip-preflight   Skip chain health validation
  --keep-running     Keep services running after tests complete
  --headed           Run browser tests in headed mode
  --verbose, -v      Verbose output
  --help, -h         Show this help

EXAMPLES:
  bun run test:e2e:full                    # Full suite
  bun run test:e2e:full --app=wallet       # Test only wallet app
  bun run test:e2e:full --ci               # CI mode with JSON reports
  bun run test:e2e:full --parallel         # Parallel execution

WORKFLOW:
  1. Start localnet (anvil chain)
  2. Deploy contracts (if not skipped)
  3. Start core services (indexer, gateway)
  4. Run preflight checks
  5. Execute E2E tests for each app
  6. Generate reports
  7. Cleanup (unless --keep-running)

REPORTS:
  Results are saved to .jeju/e2e-reports/
  - summary.json       Full test results
  - <app>-report.html  Per-app Playwright reports

`);
}

// ============================================================================
// App Discovery
// ============================================================================

function discoverApps(): AppConfig[] {
  const apps: AppConfig[] = [];
  const appsDir = join(ROOT, 'apps');

  if (!existsSync(appsDir)) return apps;

  for (const appName of APP_ORDER) {
    const appPath = join(appsDir, appName);
    if (!existsSync(appPath)) continue;

    const manifestPath = join(appPath, 'jeju-manifest.json');
    const synpressPath = join(appPath, 'synpress.config.ts');
    const packagePath = join(appPath, 'package.json');

    let port = 3000;
    let dependencies: string[] = [];

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      port = manifest.ports?.main || 3000;
      dependencies = manifest.dependencies || [];
    }

    // Find test directory
    let testDir = '';
    const testDirs = ['tests/synpress', 'tests/e2e-synpress', 'tests/e2e', 'tests/wallet', 'tests'];
    for (const dir of testDirs) {
      if (existsSync(join(appPath, dir))) {
        testDir = dir;
        break;
      }
    }

    // Check for nested app (e.g., apps/storage/app)
    const nestedAppPath = join(appPath, 'app');
    if (existsSync(join(nestedAppPath, 'synpress.config.ts'))) {
      const nestedPackage = existsSync(join(nestedAppPath, 'package.json'))
        ? JSON.parse(readFileSync(join(nestedAppPath, 'package.json'), 'utf-8'))
        : {};
      
      apps.push({
        name: `${appName}/app`,
        path: nestedAppPath,
        port: nestedPackage.port || port,
        testDir: 'tests/e2e',
        hasSynpress: true,
        dependencies,
      });
    }

    if (existsSync(synpressPath) || existsSync(packagePath)) {
      apps.push({
        name: appName,
        path: appPath,
        port,
        testDir,
        hasSynpress: existsSync(synpressPath),
        dependencies,
      });
    }
  }

  return apps;
}

// ============================================================================
// Process Management
// ============================================================================

const runningProcesses: Subprocess[] = [];
let isShuttingDown = false;

async function cleanup(keepRunning: boolean): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (keepRunning) {
    console.log('\n[E2E] Services kept running (--keep-running)');
    return;
  }

  console.log('\n[E2E] Cleaning up...');

  for (const proc of runningProcesses) {
    try {
      proc.kill();
    } catch {}
  }

  // Stop localnet
  try {
    await spawn({
      cmd: ['bun', 'run', 'localnet:stop'],
      cwd: ROOT,
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited;
  } catch {}

  console.log('[E2E] Cleanup complete');
}

function setupSignalHandlers(options: CLIOptions): void {
  process.on('SIGINT', async () => {
    await cleanup(options.keepRunning);
    process.exit(130);
  });

  process.on('SIGTERM', async () => {
    await cleanup(options.keepRunning);
    process.exit(143);
  });
}

// ============================================================================
// Infrastructure
// ============================================================================

async function startLocalnet(verbose: boolean): Promise<boolean> {
  console.log('[E2E] Starting localnet...');

  const proc = spawn({
    cmd: ['bun', 'run', 'localnet:start'],
    cwd: ROOT,
    stdout: verbose ? 'inherit' : 'ignore',
    stderr: verbose ? 'inherit' : 'ignore',
  });

  runningProcesses.push(proc);

  // Wait for RPC to be available
  const maxWait = 60000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(LOCALNET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      });
      if (response.ok) {
        console.log('[E2E] Localnet ready');
        return true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }

  console.error('[E2E] Localnet failed to start');
  return false;
}

async function deployContracts(verbose: boolean): Promise<boolean> {
  console.log('[E2E] Deploying contracts...');

  try {
    const result = await spawn({
      cmd: ['bun', 'run', 'scripts/bootstrap-localnet-complete.ts'],
      cwd: ROOT,
      stdout: verbose ? 'inherit' : 'pipe',
      stderr: verbose ? 'inherit' : 'pipe',
      env: { ...process.env, L2_RPC_URL: LOCALNET_RPC },
    }).exited;

    if (result === 0) {
      console.log('[E2E] Contracts deployed');
      return true;
    }
  } catch (error) {
    console.error('[E2E] Contract deployment failed:', error);
  }

  return false;
}

async function runPreflight(): Promise<boolean> {
  console.log('[E2E] Running preflight checks...');

  try {
    const { runPreflightChecks, waitForChain } = await import('../packages/tests/shared/preflight');

    const chainReady = await waitForChain({ rpcUrl: LOCALNET_RPC }, 30000);
    if (!chainReady) {
      console.error('[E2E] Chain not ready');
      return false;
    }

    const result = await runPreflightChecks({ rpcUrl: LOCALNET_RPC });
    return result.success;
  } catch (error) {
    console.error('[E2E] Preflight failed:', error);
    return false;
  }
}

// ============================================================================
// Test Execution
// ============================================================================

async function runAppTests(app: AppConfig, options: CLIOptions): Promise<TestResult> {
  const startTime = Date.now();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Testing: ${app.name}`);
  console.log(`  Path: ${app.path}`);
  console.log(`  Port: ${app.port}`);
  console.log(`${'='.repeat(70)}\n`);

  const result: TestResult = {
    app: app.name,
    passed: false,
    duration: 0,
    tests: 0,
    failed: 0,
    skipped: 0,
  };

  try {
    const args = ['bunx', 'playwright', 'test'];

    if (app.hasSynpress) {
      args.push('--config', 'synpress.config.ts');
    }

    if (options.headed) {
      args.push('--headed');
    }

    args.push('--reporter=list');

    if (options.ci) {
      args.push('--reporter=json');
      args.push(`--output=${join(REPORT_DIR, `${app.name.replace('/', '-')}-results.json`)}`);
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      L2_RPC_URL: LOCALNET_RPC,
      CHAIN_ID: '1337',
      CI: options.ci ? 'true' : '',
    };

    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn({
        cmd: args,
        cwd: app.path,
        stdout: 'inherit',
        stderr: 'inherit',
        env,
      });

      proc.exited.then(resolve);
    });

    result.passed = exitCode === 0;
    result.duration = Date.now() - startTime;

    if (result.passed) {
      console.log(`\n✅ ${app.name} PASSED (${(result.duration / 1000).toFixed(1)}s)`);
    } else {
      console.log(`\n❌ ${app.name} FAILED (${(result.duration / 1000).toFixed(1)}s)`);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.duration = Date.now() - startTime;
    console.log(`\n❌ ${app.name} ERROR: ${result.error}`);
  }

  return result;
}

// ============================================================================
// Reporting
// ============================================================================

function generateReport(results: TestResult[], totalDuration: number): void {
  mkdirSync(REPORT_DIR, { recursive: true });

  const summary = {
    timestamp: new Date().toISOString(),
    totalDuration,
    totalApps: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };

  writeFileSync(
    join(REPORT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(`\nReport saved to: ${REPORT_DIR}/summary.json`);
}

function printSummary(results: TestResult[], totalDuration: number): void {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                       E2E TEST SUMMARY                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    const duration = `${(result.duration / 1000).toFixed(1)}s`;
    console.log(`  ${icon} ${result.app.padEnd(25)} ${duration}`);
    if (result.error) {
      console.log(`     └─ Error: ${result.error}`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('');
  console.log('─'.repeat(70));
  console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log('─'.repeat(70));
  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const startTime = Date.now();

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                 JEJU FULL E2E TEST ORCHESTRATOR                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  setupSignalHandlers(options);

  // Discover apps
  let apps = discoverApps();

  if (options.app) {
    apps = apps.filter(a => a.name === options.app || a.name.startsWith(options.app + '/'));
    if (apps.length === 0) {
      console.error(`App not found: ${options.app}`);
      console.error('Available apps:', discoverApps().map(a => a.name).join(', '));
      process.exit(1);
    }
  }

  console.log(`Apps to test: ${apps.map(a => a.name).join(', ')}`);
  console.log('');

  // Step 1: Start localnet
  console.log('Step 1/4: Starting infrastructure...');
  if (!await startLocalnet(options.verbose)) {
    await cleanup(false);
    process.exit(1);
  }

  // Step 2: Deploy contracts
  if (!options.skipDeploy) {
    console.log('\nStep 2/4: Deploying contracts...');
    if (!await deployContracts(options.verbose)) {
      console.warn('[E2E] Contract deployment failed, continuing anyway...');
    }
  } else {
    console.log('\nStep 2/4: Skipping contract deployment (--skip-deploy)');
  }

  // Step 3: Preflight checks
  if (!options.skipPreflight) {
    console.log('\nStep 3/4: Running preflight checks...');
    if (!await runPreflight()) {
      console.error('[E2E] Preflight checks failed');
      await cleanup(false);
      process.exit(1);
    }
  } else {
    console.log('\nStep 3/4: Skipping preflight (--skip-preflight)');
  }

  // Step 4: Run tests
  console.log('\nStep 4/4: Running E2E tests...');

  const results: TestResult[] = [];

  if (options.parallel) {
    // Run tests in parallel
    const promises = apps.map(app => runAppTests(app, options));
    results.push(...await Promise.all(promises));
  } else {
    // Run tests sequentially
    for (const app of apps) {
      const result = await runAppTests(app, options);
      results.push(result);
    }
  }

  const totalDuration = Date.now() - startTime;

  // Generate reports
  generateReport(results, totalDuration);
  printSummary(results, totalDuration);

  // Cleanup
  await cleanup(options.keepRunning);

  // Exit with appropriate code
  const failed = results.filter(r => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

