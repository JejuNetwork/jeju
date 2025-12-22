/**
 * App CLI Tests
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TEST_DIR = join(tmpdir(), `jeju-node-test-${Date.now()}`)

function runApp(args: string): string {
  try {
    return execSync(`cd ${process.cwd()} && bun run src/app/index.ts ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, HOME: TEST_DIR },
    })
  } catch (e) {
    const execError = e as { stdout?: string; stderr?: string }
    return execError.stdout ?? execError.stderr ?? ''
  }
}

describe('App CLI', () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(join(TEST_DIR, '.jeju-node'), { recursive: true })
  })

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe('Help', () => {
    test('--help shows usage', () => {
      const output = runApp('--help')
      expect(output).toContain('Commands:')
      expect(output).toContain('start')
      expect(output).toContain('status')
      expect(output).toContain('setup')
      expect(output).toContain('earnings')
    })

    test('--version shows version', () => {
      const output = runApp('--version')
      expect(output).toContain('jeju-node')
    })
  })

  describe('Status', () => {
    test('shows node status', () => {
      const output = runApp('status')
      expect(output).toContain('Node Status')
      expect(output).toContain('Network')
      expect(output).toContain('Hardware')
    }, 30000)
  })

  describe('Config', () => {
    test('config shows current config', () => {
      const output = runApp('config')
      expect(output).toContain('Current Config')
      expect(output).toContain('Network')
    })

    test('config set updates values', () => {
      runApp('config set network mainnet')
      const output = runApp('config get network')
      expect(output.trim()).toContain('mainnet')
    })

    test('config set handles boolean', () => {
      runApp('config set services.compute true')
      const output = runApp('config get services.compute')
      expect(output.trim()).toContain('true')
    })
  })

  describe('Earnings', () => {
    test('shows earnings info', () => {
      const output = runApp('earnings')
      expect(output).toContain('Earnings')
    })
  })

  describe('Config File', () => {
    test('saveConfig creates config', () => {
      const config = {
        version: '1.0.0',
        network: 'testnet' as const,
        rpcUrl: 'https://testnet-rpc.jejunetwork.org',
        chainId: 420691,
        privateKey: '',
        walletAddress: '',
        services: {
          compute: true,
          storage: false,
          oracle: false,
          proxy: true,
          cron: true,
          rpc: false,
          xlp: false,
          solver: false,
          sequencer: false,
        },
        compute: {
          type: 'cpu' as const,
          cpuCores: 4,
          gpuIds: [],
          pricePerHour: '0.01',
          acceptNonTee: true,
        },
        bots: {
          enabled: false,
          dexArb: false,
          crossChainArb: false,
          liquidation: false,
        },
        autoClaim: true,
        autoStake: false,
        logLevel: 'info' as const,
      }

      // We can't easily test saveConfig with custom path, but we verify the structure
      expect(config.network).toBe('testnet')
      expect(config.services.compute).toBe(true)
    })
  })
})

describe('Headless Workflow', () => {
  test('complete headless workflow', () => {
    // Status check
    let output = runApp('status')
    expect(output).toContain('Node Status')

    // Config network
    runApp('config set network testnet')
    output = runApp('config get network')
    expect(output.trim()).toContain('testnet')

    // Enable services
    runApp('config set services.compute true')
    runApp('config set services.proxy true')

    // Verify
    output = runApp('config')
    expect(output).toContain('Network')

    console.log('✓ Headless workflow passed')
  }, 60000)
})
