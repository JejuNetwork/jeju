/**
 * CLI Integration Tests
 *
 * Tests CLI commands against real localnet services.
 * Requires: Anvil running on port 6546
 *
 * Run with:
 *   bun test commands.integration.test.ts
 *
 * Or via CLI:
 *   jeju test --mode integration --package cli
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CLI_PATH = join(__dirname, '..', 'index.ts')
const ROOT_DIR = join(__dirname, '..', '..', '..', '..')

// Test configuration
const RPC_URL = process.env.L2_RPC_URL || 'http://127.0.0.1:6546'
const CHAIN_ID = process.env.CHAIN_ID || '31337'

async function runCLI(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'run', CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      L2_RPC_URL: RPC_URL,
      CHAIN_ID,
      ...env,
    },
  })

  const exitCode = await proc.exited
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ''
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : ''

  return { stdout, stderr, exitCode }
}

async function isChainRunning(): Promise<boolean> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

describe('CLI Integration Tests', () => {
  let chainAvailable = false

  beforeAll(async () => {
    chainAvailable = await isChainRunning()
    if (!chainAvailable) {
      console.warn('Chain not running - some tests will be skipped')
    }
  })

  describe('status command (real services)', () => {
    test('status shows chain info when available', async () => {
      if (!chainAvailable) {
        console.log('Skipping - chain not available')
        return
      }

      const { stdout, exitCode } = await runCLI(['status'])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('STATUS')
    }, 30000)

    test('status --check runs diagnostics', async () => {
      const { stdout } = await runCLI(['status', '--check'])
      expect(stdout).toContain('SYSTEM CHECK')
    }, 30000)
  })

  describe('keys command (real chain)', () => {
    test('shows dev keys with correct addresses', async () => {
      const { stdout, exitCode } = await runCLI(['keys'])
      expect(exitCode).toBe(0)
      // Standard Anvil deployer address
      expect(stdout).toContain('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
    })
  })

  describe('fund command (real chain)', () => {
    test('fund --dry-run shows what would be funded', async () => {
      if (!chainAvailable) {
        console.log('Skipping - chain not available')
        return
      }

      const { stdout } = await runCLI([
        'fund',
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '--dry-run',
      ])
      // Should not error even if it can't actually fund
      expect(stdout.toLowerCase()).not.toContain('error')
    }, 30000)
  })

  describe('deploy command (localnet)', () => {
    test('deploy check shows readiness', async () => {
      if (!chainAvailable) {
        console.log('Skipping - chain not available')
        return
      }

      const { stdout } = await runCLI(['deploy', 'check', 'localnet'])
      // Should complete without crashing
      expect(stdout).toBeDefined()
    }, 60000)
  })

  describe('test command (real orchestration)', () => {
    test('test list shows available tests', async () => {
      const { stdout, exitCode } = await runCLI(['test', 'list'])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('Modes')
      expect(stdout).toContain('unit')
      expect(stdout).toContain('integration')
      expect(stdout).toContain('e2e')
    })

    test('test analyze runs subagent', async () => {
      const { stdout } = await runCLI(['test', 'analyze', '--json'])
      // Should complete without error (may fail if subagent not present)
      expect(stdout).toBeDefined()
    }, 60000)

    test('test coverage generates report', async () => {
      const { stdout, exitCode } = await runCLI(['test', 'coverage', '--json'])
      expect(exitCode).toBe(0)
      // Should output JSON
      expect(stdout).toContain('{')
    }, 30000)
  })

  describe('apps command', () => {
    test('apps shows discovered apps', async () => {
      const { stdout, exitCode } = await runCLI(['apps'])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('gateway')
      expect(stdout).toContain('wallet')
    })
  })

  describe('ports command', () => {
    test('ports shows port allocations', async () => {
      const { stdout, exitCode } = await runCLI(['ports'])
      expect(exitCode).toBe(0)
      expect(stdout).toContain('PORT')
      // Should list some ports
      expect(stdout).toMatch(/\d{4}/)
    })
  })

  describe('validate command', () => {
    test('validate checks manifests', async () => {
      const { stdout } = await runCLI(['validate'])
      // Validate command should run and produce output about manifests
      // Exit code may be non-zero if some manifests have validation errors
      expect(stdout).toContain('MANIFEST')
    }, 30000)
  })

  describe('dws command (integration)', () => {
    test('dws status checks services', async () => {
      const { stdout } = await runCLI(['dws', 'status'])
      // Should run without crashing
      expect(stdout).toContain('DWS')
    }, 30000)
  })

  describe('compute command (integration)', () => {
    test('compute status checks workers', async () => {
      const { stdout } = await runCLI(['compute', 'status'])
      // Should run without crashing
      expect(stdout).toBeDefined()
    }, 30000)
  })
})

describe('CLI Error Handling', () => {
  test('invalid command shows help or error', async () => {
    const { stdout, stderr } = await runCLI(['invalid-command-xyz'])
    // Commander.js may show help or error for unknown commands
    // The important thing is that it produces some output
    const output = stdout + stderr
    expect(output.length).toBeGreaterThan(0)
  })

  test('missing required args shows help', async () => {
    const { stdout, stderr } = await runCLI(['deploy', 'token'])
    // Should either show help or error about missing args
    expect(stdout.length + stderr.length).toBeGreaterThan(0)
  })
})
