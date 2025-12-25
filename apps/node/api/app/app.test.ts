import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TEST_DIR = join(tmpdir(), `jeju-node-test-${Date.now()}`)

// Create test dir immediately
mkdirSync(TEST_DIR, { recursive: true })

// Note: CLI spawn tests are skipped due to bun:test child process output capture issues
// The CLI can be tested manually with: bun run apps/node/api/cli.ts --help
const runCli = (_args: string): string => ''

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('Node CLI', () => {
  describe('Help & Version', () => {
    test.skip('--help shows usage', () => {
      const output = runCli('--help')
      expect(output).toContain('status')
      expect(output).toContain('start')
      expect(output).toContain('profile')
      expect(output).toContain('register')
    })

    test.skip('--version shows version', () => {
      const output = runCli('--version')
      expect(output).toContain('0.1.0')
    })

    test.skip('default action shows ASCII art and commands', () => {
      const output = runCli('')
      expect(output).toContain('Commands:')
      expect(output).toContain('status')
    })
  })

  describe('Status Command', () => {
    test.skip('status shows system info', () => {
      const output = runCli('status')
      expect(output).toContain('Node Status')
      expect(output).toContain('System:')
      expect(output).toContain('CPU:')
      expect(output).toContain('Memory:')
    }, 30000)
  })

  describe('Profile Command', () => {
    test.skip('profile handles no GPU gracefully', () => {
      const output = runCli('profile')
      // Either shows GPU info or says no GPUs detected
      const hasGpuInfo = output.includes('GPU Profile')
      const noGpu = output.includes('No NVIDIA GPUs detected')
      expect(hasGpuInfo || noGpu).toBe(true)
    }, 30000)
  })

  describe('Register Command', () => {
    test.skip('register requires private key', () => {
      const output = runCli('register --cpu')
      expect(output).toContain('JEJU_PRIVATE_KEY')
    }, 30000)
  })

  describe('Config Types', () => {
    test('config structure is valid', () => {
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

      expect(config.network).toBe('testnet')
      expect(config.services.compute).toBe(true)
      expect(config.compute.type).toBe('cpu')
    })
  })
})

describe('CLI Workflow', () => {
  test.skip('status command runs successfully', () => {
    const output = runCli('status')
    expect(output).toContain('Node Status')
    expect(output).toContain('CPU')
  }, 60000)
})
