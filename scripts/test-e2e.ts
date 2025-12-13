#!/usr/bin/env bun
/**
 * Jeju E2E Test Orchestrator
 *
 * Single entry point for all E2E/Synpress tests with:
 * - Test locking to prevent concurrent runs
 * - Pre-flight chain validation
 * - App warmup for faster tests
 * - Unified test execution
 *
 * Usage:
 *   bun run test:e2e                    # Full suite with lock + preflight
 *   bun run test:e2e --app=bazaar       # Single app
 *   bun run test:e2e --smoke            # Just preflight + basic test
 *   bun run test:e2e --skip-preflight   # Skip chain validation
 *   bun run test:e2e --skip-warmup      # Skip app warmup
 *   bun run test:e2e --force            # Override lock
 *   bun run test:e2e --list             # List available apps
 */

import { spawn } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { LockManager } from '../packages/tests/shared/lock-manager';
import { runPreflightChecks, waitForChain } from '../packages/tests/shared/preflight';
import { quickWarmup, discoverAppsForWarmup } from '../packages/tests/shared/warmup';

interface CLIOptions {
  app?: string;
  smoke: boolean;
  skipPreflight: boolean;
  skipWarmup: boolean;
  skipLock: boolean;
  force: boolean;
  list: boolean;
  help: boolean;
  headed: boolean;
  debug: boolean;
}

interface AppTestConfig {
  name: string;
  path: string;
  port: number;
  synpressConfig: string;
  testDir: string;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    smoke: false,
    skipPreflight: false,
    skipWarmup: false,
    skipLock: false,
    force: false,
    list: false,
    help: false,
    headed: false,
    debug: false,
  };

  for (const arg of args) {
    if (arg === '--smoke') options.smoke = true;
    else if (arg === '--skip-preflight') options.skipPreflight = true;
    else if (arg === '--skip-warmup') options.skipWarmup = true;
    else if (arg === '--skip-lock') options.skipLock = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--debug') options.debug = true;
    else if (arg.startsWith('--app=')) options.app = arg.split('=')[1];
  }

  return options;
}

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    JEJU E2E TEST ORCHESTRATOR                        ║
╚══════════════════════════════════════════════════════════════════════╝

USAGE:
  bun run test:e2e [options]

OPTIONS:
  --app=<name>        Run tests for a specific app (e.g., --app=bazaar)
  --smoke             Run only smoke tests (preflight + basic connectivity)
  --skip-preflight    Skip chain health validation
  --skip-warmup       Skip app warmup/page caching
  --skip-lock         Skip test lock acquisition
  --force             Override existing test lock
  --headed            Run tests in headed mode (visible browser)
  --debug             Enable debug output
  --list              List available apps with E2E tests
  --help, -h          Show this help message

EXAMPLES:
  bun run test:e2e                    # Run all E2E tests
  bun run test:e2e --app=bazaar       # Run only bazaar tests
  bun run test:e2e --smoke            # Quick smoke test
  bun run test:e2e --force            # Override lock from another run
  bun run test:e2e --headed --debug   # Debug mode with visible browser

ENVIRONMENT VARIABLES:
  L2_RPC_URL          RPC URL for chain (default: http://localhost:9545)
  CHAIN_ID            Chain ID (default: 1337)
  FORCE_TESTS         Same as --force flag
  SKIP_PREFLIGHT      Same as --skip-preflight flag
  SKIP_WARMUP         Same as --skip-warmup flag

PREREQUISITES:
  1. Localnet running: bun run dev
  2. Apps started: Apps should be running or will be started automatically

`);
}

function discoverE2EApps(): AppTestConfig[] {
  const apps: AppTestConfig[] = [];
  const appsDir = join(process.cwd(), 'apps');

  if (!existsSync(appsDir)) return apps;

  const appDirs = readdirSync(appsDir);

  for (const appName of appDirs) {
    if (appName.startsWith('.') || appName === 'node_modules') continue;

    const appPath = join(appsDir, appName);
    const synpressConfigPath = join(appPath, 'synpress.config.ts');
    const manifestPath = join(appPath, 'jeju-manifest.json');

    if (!existsSync(synpressConfigPath)) continue;

    let port = 3000;
    let testDir = './tests/wallet';

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      port = manifest.ports?.main || 3000;
    }

    // Check for common test directories
    const possibleTestDirs = [
      './tests/wallet',
      './tests/e2e-synpress',
      './tests/synpress',
      './tests/e2e',
    ];

    for (const dir of possibleTestDirs) {
      if (existsSync(join(appPath, dir))) {
        testDir = dir;
        break;
      }
    }

    apps.push({
      name: appName,
      path: appPath,
      port,
      synpressConfig: synpressConfigPath,
      testDir,
    });
  }

  return apps;
}

function listApps(): void {
  const apps = discoverE2EApps();

  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                    APPS WITH E2E TESTS                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  if (apps.length === 0) {
    console.log('No apps with synpress.config.ts found.\n');
    return;
  }

  console.log('App Name          Port    Test Directory');
  console.log('─'.repeat(60));

  for (const app of apps) {
    console.log(`${app.name.padEnd(18)}${String(app.port).padEnd(8)}${app.testDir}`);
  }

  console.log('─'.repeat(60));
  console.log(`\nTotal: ${apps.length} app(s)`);
  console.log('Run: bun run test:e2e --app=<name>\n');
}

async function runAppTests(app: AppTestConfig, headed: boolean): Promise<boolean> {
  console.log(`\n[${'='.repeat(66)}]`);
  console.log(`  Running E2E tests for: ${app.name}`);
  console.log(`  Port: ${app.port}`);
  console.log(`  Test Dir: ${app.testDir}`);
  console.log(`[${'='.repeat(66)}]\n`);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SYNPRESS_CACHE_DIR: join(process.cwd(), '.synpress-cache'),
  };

  const args = [
    'bunx',
    'playwright',
    'test',
    '--config',
    'synpress.config.ts',
    '--reporter=list',
  ];

  if (headed) {
    args.push('--headed');
  }

  return new Promise((resolve) => {
    const proc = spawn({
      cmd: args,
      cwd: app.path,
      stdout: 'inherit',
      stderr: 'inherit',
      env,
    });

    proc.exited.then((exitCode) => {
      if (exitCode === 0) {
        console.log(`\n✅ ${app.name} tests PASSED\n`);
        resolve(true);
      } else {
        console.log(`\n❌ ${app.name} tests FAILED (exit code: ${exitCode})\n`);
        resolve(false);
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.list) {
    listApps();
    process.exit(0);
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                    JEJU E2E TEST ORCHESTRATOR                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  let lockManager: LockManager | null = null;

  // Step 1: Acquire lock
  if (!options.skipLock) {
    console.log('Step 1/4: Acquiring test lock...');
    lockManager = new LockManager({ force: options.force });
    const lockResult = lockManager.acquireLock();

    if (!lockResult.acquired) {
      console.error('\n❌ FAILED TO ACQUIRE TEST LOCK');
      console.error(lockResult.message);
      console.error('\nUse --force to override\n');
      process.exit(1);
    }
    console.log('  ✅ Lock acquired\n');
  } else {
    console.log('Step 1/4: Skipping lock (--skip-lock)\n');
  }

  // Cleanup handler
  const cleanup = () => {
    if (lockManager) {
      lockManager.releaseLock();
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    // Step 2: Preflight checks
    if (!options.skipPreflight) {
      console.log('Step 2/4: Running preflight checks...');

      const chainReady = await waitForChain({}, 30000);
      if (!chainReady) {
        console.error('\n❌ Chain not ready - is localnet running?');
        console.error('Start with: bun run dev\n');
        cleanup();
        process.exit(1);
      }

      const preflightResult = await runPreflightChecks();
      if (!preflightResult.success) {
        console.error('\n❌ Preflight checks failed\n');
        cleanup();
        process.exit(1);
      }
    } else {
      console.log('Step 2/4: Skipping preflight (--skip-preflight)\n');
    }

    // Smoke test mode - exit after preflight
    if (options.smoke) {
      console.log('Smoke test mode - skipping app tests\n');
      console.log('✅ Smoke test PASSED\n');
      cleanup();
      process.exit(0);
    }

    // Step 3: Warmup
    if (!options.skipWarmup) {
      console.log('Step 3/4: Warming up apps...');
      await quickWarmup(options.app ? [options.app] : undefined);
      console.log('');
    } else {
      console.log('Step 3/4: Skipping warmup (--skip-warmup)\n');
    }

    // Step 4: Run tests
    console.log('Step 4/4: Running E2E tests...');

    let apps = discoverE2EApps();

    if (options.app) {
      apps = apps.filter((a) => a.name === options.app);
      if (apps.length === 0) {
        console.error(`\n❌ App not found: ${options.app}`);
        console.error('Use --list to see available apps\n');
        cleanup();
        process.exit(1);
      }
    }

    if (apps.length === 0) {
      console.log('\nNo apps with E2E tests found.\n');
      cleanup();
      process.exit(0);
    }

    console.log(`\nRunning tests for ${apps.length} app(s): ${apps.map((a) => a.name).join(', ')}\n`);

    const results: { app: string; passed: boolean }[] = [];

    for (const app of apps) {
      const passed = await runAppTests(app, options.headed);
      results.push({ app: app.name, passed });
    }

    // Summary
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                         TEST SUMMARY                                 ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');
    console.log('');

    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    for (const result of results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`  ${icon} ${result.app}`);
    }

    console.log('');
    console.log('─'.repeat(70));
    console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log('─'.repeat(70));
    console.log('');

    cleanup();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
    cleanup();
    process.exit(1);
  }
}

main();

