import { describe, test, expect } from 'bun:test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this test file reliably
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = join(__dirname, 'index.ts');
const ROOT_DIR = join(__dirname, '..', '..', '..');

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
    cwd: ROOT_DIR,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  
  const exitCode = await proc.exited;
  
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : '';
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : '';
  
  return { stdout, stderr, exitCode };
}

describe('CLI Core', () => {
  test('--help shows 6 commands', async () => {
    const { stdout, exitCode } = await runCLI(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dev');
    expect(stdout).toContain('test');
    expect(stdout).toContain('deploy');
    expect(stdout).toContain('keys');
    expect(stdout).toContain('status');
    expect(stdout).toContain('fund');
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
    expect(stdout).toContain('jeju deploy');
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
    expect(stdout).toContain('--mode');
    expect(stdout).toContain('--ci');
    expect(stdout).toContain('unit');
    expect(stdout).toContain('integration');
    expect(stdout).toContain('e2e');
  });
});

describe('deploy command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['deploy', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('testnet');
    expect(stdout).toContain('mainnet');
    expect(stdout).toContain('--contracts');
    expect(stdout).toContain('--infrastructure');
    expect(stdout).toContain('--apps');
  });

  test('verify subcommand exists', async () => {
    const { stdout, exitCode } = await runCLI(['deploy', 'verify', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Verify contract deployments');
  });

  test('check subcommand exists', async () => {
    const { stdout, exitCode } = await runCLI(['deploy', 'check', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('readiness check');
  });

  test('token subcommand exists', async () => {
    const { stdout, exitCode } = await runCLI(['deploy', 'token', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('NetworkToken');
    expect(stdout).toContain('--safe');
    expect(stdout).toContain('--network');
  });

  test('oif subcommand exists', async () => {
    const { stdout, exitCode } = await runCLI(['deploy', 'oif', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Open Intents Framework');
    expect(stdout).toContain('--oracle-type');
  });
});

describe('keys command', () => {
  test('shows dev keys', async () => {
    const { stdout, exitCode } = await runCLI(['keys']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('KEYS');
    expect(stdout).toContain('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  test('genesis --help shows ceremony options', async () => {
    const { stdout, exitCode } = await runCLI(['keys', 'genesis', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Secure key generation ceremony');
    expect(stdout).toContain('--network');
  });

  test('supports burn action', async () => {
    const { stdout, exitCode } = await runCLI(['keys', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('show | genesis | burn');
  });
});

describe('status command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['status', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--check');
  });

  test('--check runs full diagnostics', async () => {
    const { stdout } = await runCLI(['status', '--check']);
    // May timeout without docker, just verify it starts
    expect(stdout).toContain('SYSTEM CHECK');
  }, 30000);
});

describe('fund command', () => {
  test('--help shows options', async () => {
    const { stdout, exitCode } = await runCLI(['fund', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Fund accounts');
    expect(stdout).toContain('--all');
  });
});

describe('dws command', () => {
  test('--help shows all subcommands', async () => {
    const { stdout, exitCode } = await runCLI(['dws', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Decentralized Web Services');
    expect(stdout).toContain('status');
    expect(stdout).toContain('start');
    expect(stdout).toContain('upload');
    expect(stdout).toContain('download');
    expect(stdout).toContain('repos');
    expect(stdout).toContain('repo');
    expect(stdout).toContain('create-repo');
    expect(stdout).toContain('pkg-search');
    expect(stdout).toContain('pkg-info');
    expect(stdout).toContain('workflows');
    expect(stdout).toContain('runs');
    expect(stdout).toContain('cdn-status');
  });

  test('status subcommand exists', async () => {
    const { stdout, exitCode } = await runCLI(['dws', 'status', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Check DWS services status');
  });

  test('start subcommand has network option', async () => {
    const { stdout, exitCode } = await runCLI(['dws', 'start', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--network');
    expect(stdout).toContain('--port');
  });

  test('repos subcommand has user filter', async () => {
    const { stdout, exitCode } = await runCLI(['dws', 'repos', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--user');
    expect(stdout).toContain('--limit');
  });

  test('create-repo subcommand has options', async () => {
    const { stdout, exitCode } = await runCLI(['dws', 'create-repo', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--description');
    expect(stdout).toContain('--private');
  });
});

describe('compute command', () => {
  test('--help shows all subcommands', async () => {
    const { stdout, exitCode } = await runCLI(['compute', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('DWS compute operations');
    expect(stdout).toContain('status');
    expect(stdout).toContain('start');
    expect(stdout).toContain('node');
    expect(stdout).toContain('submit');
    expect(stdout).toContain('jobs');
    expect(stdout).toContain('job');
    expect(stdout).toContain('cancel');
    expect(stdout).toContain('inference');
  });

  test('submit subcommand has options', async () => {
    const { stdout, exitCode } = await runCLI(['compute', 'submit', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--shell');
    expect(stdout).toContain('--timeout');
    expect(stdout).toContain('--address');
  });

  test('jobs subcommand has filters', async () => {
    const { stdout, exitCode } = await runCLI(['compute', 'jobs', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--status');
    expect(stdout).toContain('--limit');
  });

  test('inference subcommand has model option', async () => {
    const { stdout, exitCode } = await runCLI(['compute', 'inference', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--model');
    expect(stdout).toContain('--system');
  });

  test('node subcommand has network option', async () => {
    const { stdout, exitCode } = await runCLI(['compute', 'node', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--network');
    expect(stdout).toContain('--port');
  });
});
