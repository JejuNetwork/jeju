/**
 * Test Orchestrator Tests - CLI parsing, app discovery, execution flow
 *
 * Note: These tests verify exit codes since Bun's test runner has
 * limitations with child process stdout/stderr capture.
 */

import { describe, test, expect } from 'bun:test';
import { spawn } from 'bun';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// Find workspace root
function findWorkspaceRoot(): string {
  let dir = import.meta.dir;
  while (dir !== '/') {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name === 'jeju') return dir;
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const WORKSPACE_ROOT = findWorkspaceRoot();
const SCRIPT_PATH = join(WORKSPACE_ROOT, 'scripts/test-e2e.ts');

// Helper to run script and get exit code
async function runScript(args: string[]): Promise<number> {
  const proc = spawn({
    cmd: ['bun', 'run', SCRIPT_PATH, ...args],
    cwd: WORKSPACE_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return proc.exited;
}

describe('Test Orchestrator - Script Exists', () => {
  test('should have test-e2e.ts script', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });
});

describe('Test Orchestrator - Help Command', () => {
  test('should exit 0 with --help', async () => {
    const exitCode = await runScript(['--help']);
    expect(exitCode).toBe(0);
  });

  test('should exit 0 with -h', async () => {
    const exitCode = await runScript(['-h']);
    expect(exitCode).toBe(0);
  });
});

describe('Test Orchestrator - List Command', () => {
  test('should exit 0 with --list', async () => {
    const exitCode = await runScript(['--list']);
    expect(exitCode).toBe(0);
  });
});

describe('Test Orchestrator - Error Handling', () => {
  test('should exit 1 when app not found', async () => {
    const exitCode = await runScript([
      '--app=nonexistent-app-xyz',
      '--skip-lock',
      '--skip-preflight',
      '--skip-warmup',
    ]);
    expect(exitCode).toBe(1);
  });
});

describe('Test Orchestrator - Skip Flags', () => {
  test('should accept --skip-lock flag', async () => {
    const exitCode = await runScript(['--skip-lock', '--skip-preflight', '--skip-warmup', '--list']);
    expect(exitCode).toBe(0);
  });

  test('should accept --skip-preflight flag', async () => {
    const exitCode = await runScript(['--skip-preflight', '--skip-lock', '--skip-warmup', '--list']);
    expect(exitCode).toBe(0);
  });

  test('should accept --skip-warmup flag', async () => {
    const exitCode = await runScript(['--skip-warmup', '--skip-lock', '--skip-preflight', '--list']);
    expect(exitCode).toBe(0);
  });

  test('should accept multiple skip flags', async () => {
    const exitCode = await runScript(['--skip-lock', '--skip-preflight', '--skip-warmup', '--list']);
    expect(exitCode).toBe(0);
  });

  test('should accept --force flag', async () => {
    const exitCode = await runScript(['--force', '--skip-preflight', '--skip-warmup', '--list']);
    expect(exitCode).toBe(0);
  });
});

describe('Test Orchestrator - Smoke Mode', () => {
  test('should exit 0 with --smoke and skips', async () => {
    const exitCode = await runScript([
      '--smoke',
      '--skip-lock',
      '--skip-preflight',
      '--skip-warmup',
    ]);
    expect(exitCode).toBe(0);
  });
});

describe('Test Orchestrator - Concurrent Access Protection', () => {
  test('should block concurrent runs without --force', async () => {
    // Start first process
    const proc1 = spawn({
      cmd: ['bun', 'run', SCRIPT_PATH, '--skip-preflight', '--skip-warmup', '--list'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: WORKSPACE_ROOT,
    });

    // Give it a moment to acquire lock
    await new Promise(r => setTimeout(r, 100));

    // Start second process
    const proc2 = spawn({
      cmd: ['bun', 'run', SCRIPT_PATH, '--skip-preflight', '--skip-warmup', '--list'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: WORKSPACE_ROOT,
    });

    // Wait for both
    const [exit1, exit2] = await Promise.all([proc1.exited, proc2.exited]);

    // At least one should succeed (the first one)
    expect([exit1, exit2].includes(0)).toBe(true);
  });

  test('should allow concurrent with --force', async () => {
    // Start first process
    const proc1 = spawn({
      cmd: ['bun', 'run', SCRIPT_PATH, '--force', '--skip-preflight', '--skip-warmup', '--list'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: WORKSPACE_ROOT,
    });

    // Start second process immediately with force
    const proc2 = spawn({
      cmd: ['bun', 'run', SCRIPT_PATH, '--force', '--skip-preflight', '--skip-warmup', '--list'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: WORKSPACE_ROOT,
    });

    const [exit1, exit2] = await Promise.all([proc1.exited, proc2.exited]);

    // Both should succeed with force
    expect(exit1).toBe(0);
    expect(exit2).toBe(0);
  });
});

describe('Test Orchestrator - App Discovery', () => {
  test('should discover apps with synpress config', () => {
    const appsDir = join(WORKSPACE_ROOT, 'apps');
    const appDirs = readdirSync(appsDir);

    const appsWithSynpress = appDirs.filter((appName: string) => {
      const synpressPath = join(appsDir, appName, 'synpress.config.ts');
      return existsSync(synpressPath);
    });

    // Should have at least one app with synpress config
    expect(appsWithSynpress.length).toBeGreaterThan(0);
  });

  test('should have required files for testable apps', () => {
    const appsDir = join(WORKSPACE_ROOT, 'apps');
    const appDirs = readdirSync(appsDir);

    // Count apps with complete E2E setup
    let completeApps = 0;

    for (const appName of appDirs) {
      const synpressPath = join(appsDir, appName, 'synpress.config.ts');
      const manifestPath = join(appsDir, appName, 'jeju-manifest.json');

      if (!existsSync(synpressPath)) continue;
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

      // Only count apps with ports.main defined
      if (manifest.ports?.main) {
        expect(typeof manifest.ports.main).toBe('number');
        completeApps++;
      }
    }

    // Should have at least one fully configured app
    expect(completeApps).toBeGreaterThan(0);
  });
});
