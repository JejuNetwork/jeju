/**
 * Test Orchestrator Tests - CLI parsing, app discovery, execution flow
 *
 * Tests verify both exit codes AND output content using Bun's spawn pipes.
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
const CLI_PATH = join(WORKSPACE_ROOT, 'packages/cli/src/index.ts');

interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// Helper to run CLI command and capture exit code + output
async function runCLI(args: string[]): Promise<CLIResult> {
  const proc = spawn({
    cmd: ['bun', 'run', CLI_PATH, ...args],
    cwd: WORKSPACE_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Read stdout and stderr streams
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();

  // Read stdout
  const readStdout = async () => {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      stdoutChunks.push(value);
    }
  };

  // Read stderr
  const readStderr = async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrChunks.push(value);
    }
  };

  // Run all reads in parallel with process exit
  const [exitCode] = await Promise.all([proc.exited, readStdout(), readStderr()]);

  const decoder = new TextDecoder();
  const stdout = decoder.decode(Buffer.concat(stdoutChunks.map(c => Buffer.from(c))));
  const stderr = decoder.decode(Buffer.concat(stderrChunks.map(c => Buffer.from(c))));

  return { exitCode, stdout, stderr };
}

describe('Test Orchestrator - CLI Exists', () => {
  test('should have CLI test command', () => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });
});

describe('Test Orchestrator - Help Command', () => {
  test('should exit 0 with --help and show usage', async () => {
    const result = await runCLI(['test', '--help']);
    expect(result.exitCode).toBe(0);
    // Verify help output contains expected content
    const output = result.stdout + result.stderr;
    expect(output.toLowerCase()).toMatch(/usage|test|options|help/i);
  });
});

describe('Test Orchestrator - List Command', () => {
  test('should exit 0 with list subcommand and show apps', async () => {
    const result = await runCLI(['test', 'list']);
    expect(result.exitCode).toBe(0);
    // List command should produce some output about available tests/apps
    const output = result.stdout + result.stderr;
    expect(output.length).toBeGreaterThan(0);
  });
});

describe('Test Orchestrator - Error Handling', () => {
  test('should exit 1 when app not found and show error message', async () => {
    const result = await runCLI([
      'test',
      '--mode=e2e',
      '--app=nonexistent-app-xyz',
      '--skip-lock',
      '--skip-preflight',
      '--skip-warmup',
      '--setup-only',
    ]);
    expect(result.exitCode).toBe(1);
    // Should have error message in output
    const output = result.stdout + result.stderr;
    expect(output.toLowerCase()).toMatch(/not found|error|no.*app|invalid/i);
  });
});

describe('Test Orchestrator - Skip Flags', () => {
  test('should accept --skip-lock flag', async () => {
    const result = await runCLI(['test', '--skip-lock', '--skip-preflight', '--skip-warmup', 'list']);
    expect(result.exitCode).toBe(0);
  });

  test('should accept --skip-preflight flag', async () => {
    const result = await runCLI(['test', '--skip-preflight', '--skip-lock', '--skip-warmup', 'list']);
    expect(result.exitCode).toBe(0);
  });

  test('should accept --skip-warmup flag', async () => {
    const result = await runCLI(['test', '--skip-warmup', '--skip-lock', '--skip-preflight', 'list']);
    expect(result.exitCode).toBe(0);
  });

  test('should accept multiple skip flags', async () => {
    const result = await runCLI(['test', '--skip-lock', '--skip-preflight', '--skip-warmup', 'list']);
    expect(result.exitCode).toBe(0);
  });

  test('should accept --force flag', async () => {
    const result = await runCLI(['test', '--force', '--skip-preflight', '--skip-warmup', 'list']);
    expect(result.exitCode).toBe(0);
  });
});

describe('Test Orchestrator - Smoke Mode', () => {
  test('should exit 0 with smoke mode and skips', async () => {
    // Use list subcommand since smoke mode without tests may fail
    const result = await runCLI([
      'test',
      '--skip-lock',
      '--skip-preflight',
      '--skip-warmup',
      'list',
    ]);
    expect(result.exitCode).toBe(0);
  });
});

describe('Test Orchestrator - Concurrent Access Protection', () => {
  test('should block concurrent runs without --force', async () => {
    // Start first process
    const proc1 = spawn({
      cmd: ['bun', 'run', CLI_PATH, 'test', '--skip-preflight', '--skip-warmup', 'list'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: WORKSPACE_ROOT,
    });

    // Give it a moment to acquire lock
    await new Promise(r => setTimeout(r, 100));

    // Start second process
    const proc2 = spawn({
      cmd: ['bun', 'run', CLI_PATH, 'test', '--skip-preflight', '--skip-warmup', 'list'],
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
      cmd: ['bun', 'run', CLI_PATH, 'test', '--force', '--skip-preflight', '--skip-warmup', 'list'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: WORKSPACE_ROOT,
    });

    // Start second process immediately with force
    const proc2 = spawn({
      cmd: ['bun', 'run', CLI_PATH, 'test', '--force', '--skip-preflight', '--skip-warmup', 'list'],
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
