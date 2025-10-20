#!/usr/bin/env bun
/**
 * Unified Test Runner for eHorse
 * Runs all test types: quick sanity tests, unit tests, and E2E tests
 */

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const testType = args[0] || 'quick';

function exec(cmd: string, silent = false): void {
  execSync(cmd, { 
    encoding: 'utf-8', 
    stdio: silent ? 'pipe' : 'inherit',
    cwd: process.cwd()
  });
}

function log(msg: string): void {
  console.log(msg);
}

async function runQuickTests(): Promise<void> {
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║                                                              ║');
  log('║   🧪 Running Quick Sanity Tests                              ║');
  log('║                                                              ║');
  log('╚══════════════════════════════════════════════════════════════╝\n');

  exec('bun run scripts/test.ts');
}

async function runE2ETests(): Promise<void> {
  log('\n╔══════════════════════════════════════════════════════════════╗');
  log('║                                                              ║');
  log('║   🧪 Running E2E Tests with Playwright                       ║');
  log('║                                                              ║');
  log('╚══════════════════════════════════════════════════════════════╝\n');

  exec('npx playwright test');
}

async function runAllTests(): Promise<void> {
  log('╔══════════════════════════════════════════════════════════════╗');
  log('║                                                              ║');
  log('║   🧪 Running All eHorse Tests                                ║');
  log('║                                                              ║');
  log('╚══════════════════════════════════════════════════════════════╝\n');

  // Check if server is running
  try {
    const response = await fetch('http://localhost:5700/health');
    if (!response.ok) {
      log('⚠️  eHorse server is not responding properly');
      log('   Make sure to start it with: bun run dev\n');
      process.exit(1);
    }
  } catch {
    log('⚠️  eHorse server is not running!');
    log('   Start it first with: bun run dev\n');
    process.exit(1);
  }

  // Run quick tests
  await runQuickTests();

  // Check if E2E environment is set up
  const fs = await import('fs');
  if (fs.existsSync('tests/test-config.json')) {
    log('\n✅ E2E test environment detected\n');
    await runE2ETests();
  } else {
    log('\n⚠️  E2E test environment not set up');
    log('   Run: bun run test:setup (requires anvil running)\n');
  }

  log('\n╔══════════════════════════════════════════════════════════════╗');
  log('║                                                              ║');
  log('║   ✅ All Tests Complete!                                     ║');
  log('║                                                              ║');
  log('╚══════════════════════════════════════════════════════════════╝\n');
}

async function main(): Promise<void> {
  switch (testType) {
    case 'quick':
      await runQuickTests();
      break;
    case 'e2e':
      await runE2ETests();
      break;
    case 'all':
      await runAllTests();
      break;
    default:
      log('Usage: bun run test [quick|e2e|all]');
      log('  quick - Run quick sanity tests (default)');
      log('  e2e   - Run E2E tests with Playwright');
      log('  all   - Run all tests');
      process.exit(1);
  }
}

main();


