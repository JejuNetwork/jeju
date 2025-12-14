import { describe, test, expect, beforeAll } from 'bun:test';
import { execa } from 'execa';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

const CLI_PATH = join(import.meta.dir, 'index.ts');

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execa('bun', ['run', CLI_PATH, ...args]);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode || 0,
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; exitCode?: number };
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.exitCode || 1,
    };
  }
}

describe('CLI Core', () => {
  test('--help shows 6 commands', async () => {
    const { stdout, exitCode } = await runCLI(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dev');
    expect(stdout).toContain('test');
    expect(stdout).toContain('deploy');
    expect(stdout).toContain('init');
    expect(stdout).toContain('keys');
    expect(stdout).toContain('status');
  });

  test('--version shows version', async () => {
    const { stdout, exitCode } = await runCLI(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  test('no args shows quick start', async () => {
    const { stdout } = await runCLI([]);
    expect(stdout).toContain('Development');
    expect(stdout).toContain('jeju dev');
    expect(stdout).toContain('jeju init');
  });
});

describe('dev command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['dev', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--minimal');
    expect(stdout).toContain('--stop');
  });
});

describe('test command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['test', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--phase');
    expect(stdout).toContain('--ci');
  });
});

describe('deploy command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['deploy', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('testnet');
    expect(stdout).toContain('mainnet');
    expect(stdout).toContain('--contracts');
  });
});

describe('init command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['init', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Initialize');
    expect(stdout).toContain('--type');
  });
});

describe('keys command', () => {
  test('shows dev keys', async () => {
    const { stdout, exitCode } = await runCLI(['keys']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('KEYS');
    expect(stdout).toContain('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  test('genesis --help', async () => {
    const { stdout, exitCode } = await runCLI(['keys', 'genesis', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Secure key generation');
  });
});

describe('status command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['status', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--check');
  });

  test('--check runs full diagnostics', async () => {
    const { stdout, exitCode } = await runCLI(['status', '--check']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('SYSTEM CHECK');
    expect(stdout).toContain('Dependencies');
  });
});
