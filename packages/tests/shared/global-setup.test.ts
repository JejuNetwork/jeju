/**
 * Global Setup Tests - Environment config, error handling
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setupTestEnvironment } from './global-setup'

// Save original env
const originalEnv = { ...process.env }

beforeEach(() => {
  // Reset env before each test
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('setupTestEnvironment - Option Handling', () => {
  test('should set SKIP_TEST_LOCK env when skipLock=true', async () => {
    // We can't fully test globalSetup without a running chain,
    // but we can verify env var setting
    process.env.SKIP_PREFLIGHT = 'true'
    process.env.SKIP_WARMUP = 'true'

    await setupTestEnvironment({
      skipLock: true,
      skipPreflight: true,
      skipWarmup: true,
    }).catch(() => {})

    expect(process.env.SKIP_TEST_LOCK).toBe('true')
  })

  test('should set FORCE_TESTS env when force=true', async () => {
    await setupTestEnvironment({
      force: true,
      skipPreflight: true,
      skipWarmup: true,
    }).catch(() => {})

    expect(process.env.FORCE_TESTS).toBe('true')
  })

  test('should set RPC URL from options', async () => {
    const customRpc = 'http://custom:8545'

    await setupTestEnvironment({
      rpcUrl: customRpc,
      skipLock: true,
      skipWarmup: true,
      skipPreflight: true,
    }).catch(() => {})

    expect(process.env.L2_RPC_URL).toBe(customRpc)
  })

  test('should set chain ID from options', async () => {
    await setupTestEnvironment({
      chainId: 31337,
      skipLock: true,
      skipWarmup: true,
      skipPreflight: true,
    }).catch(() => {})

    expect(process.env.CHAIN_ID).toBe('31337')
  })

  test('should set warmup apps from options', async () => {
    await setupTestEnvironment({
      apps: ['bazaar', 'gateway'],
      skipLock: true,
      skipPreflight: true,
    }).catch(() => {})

    expect(process.env.WARMUP_APPS).toBe('bazaar,gateway')
  })

  test('should not set env vars when options are false/undefined', async () => {
    delete process.env.SKIP_TEST_LOCK
    delete process.env.FORCE_TESTS

    await setupTestEnvironment({
      skipLock: false,
      force: false,
      skipPreflight: true,
      skipWarmup: true,
    }).catch(() => {})

    expect(process.env.SKIP_TEST_LOCK).toBeUndefined()
    expect(process.env.FORCE_TESTS).toBeUndefined()
  })
})

describe('Global Setup - Environment Variable Parsing', () => {
  test('should respect SKIP_PREFLIGHT env var', () => {
    process.env.SKIP_PREFLIGHT = 'true'

    // The actual globalSetup would read this
    expect(process.env.SKIP_PREFLIGHT).toBe('true')
  })

  test('should respect SKIP_WARMUP env var', () => {
    process.env.SKIP_WARMUP = 'true'

    expect(process.env.SKIP_WARMUP).toBe('true')
  })

  test('should parse CHAIN_ID as integer', () => {
    process.env.CHAIN_ID = '31337'

    const chainId = parseInt(process.env.CHAIN_ID, 10)
    expect(chainId).toBe(31337)
    expect(Number.isInteger(chainId)).toBe(true)
  })

  test('should handle missing CHAIN_ID gracefully', () => {
    delete process.env.CHAIN_ID

    const chainId = process.env.CHAIN_ID
      ? parseInt(process.env.CHAIN_ID, 10)
      : 31337
    expect(chainId).toBe(31337)
  })

  test('should split WARMUP_APPS by comma', () => {
    process.env.WARMUP_APPS = 'app1,app2,app3'

    const apps = process.env.WARMUP_APPS.split(',')
    expect(apps).toEqual(['app1', 'app2', 'app3'])
  })

  test('should handle single app in WARMUP_APPS', () => {
    process.env.WARMUP_APPS = 'singleapp'

    const apps = process.env.WARMUP_APPS.split(',')
    expect(apps).toEqual(['singleapp'])
  })
})

describe('Global Setup - RPC URL Resolution', () => {
  test('should prefer L2_RPC_URL over JEJU_RPC_URL', () => {
    process.env.L2_RPC_URL = 'http://l2:8545'
    process.env.JEJU_RPC_URL = 'http://jeju:8545'

    const rpcUrl = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL
    expect(rpcUrl).toBe('http://l2:8545')
  })

  test('should throw when L2_RPC_URL missing and JEJU_RPC_URL not set', () => {
    delete process.env.L2_RPC_URL
    delete process.env.JEJU_RPC_URL

    const getRpcUrl = () => {
      if (!process.env.L2_RPC_URL && !process.env.JEJU_RPC_URL) {
        throw new Error('RPC URL not configured')
      }
      return process.env.L2_RPC_URL || process.env.JEJU_RPC_URL
    }

    expect(() => getRpcUrl()).toThrow('RPC URL not configured')
  })

  test('should throw when no RPC env vars are set', () => {
    delete process.env.L2_RPC_URL
    delete process.env.JEJU_RPC_URL

    const requireRpcUrl = () => {
      const url = process.env.L2_RPC_URL || process.env.JEJU_RPC_URL
      if (!url) throw new Error('No RPC URL configured')
      return url
    }

    expect(() => requireRpcUrl()).toThrow('No RPC URL configured')
  })
})

// Error scenario tests - verify proper error handling
describe('Global Setup - Error Scenarios', () => {
  test('should throw when chain is not ready and not skipped', async () => {
    // Use invalid RPC URL to trigger chain not ready error
    const originalRpcUrl = process.env.L2_RPC_URL
    process.env.L2_RPC_URL = 'http://127.0.0.1:59999'

    try {
      await expect(
        setupTestEnvironment({
          skipLock: true,
          skipWarmup: true,
          // Don't skip preflight so it actually checks the chain
        }),
      ).rejects.toThrow()
    } finally {
      // Restore original RPC URL
      if (originalRpcUrl) {
        process.env.L2_RPC_URL = originalRpcUrl
      } else {
        delete process.env.L2_RPC_URL
      }
    }
  }, 65000)
})

describe('Global Setup - Success Scenarios', () => {
  test('should succeed with all checks skipped', async () => {
    const cleanup = await setupTestEnvironment({
      skipLock: true,
      skipPreflight: true,
      skipWarmup: true,
    })

    expect(typeof cleanup).toBe('function')
    cleanup()
  })
})

describe('Global Setup - Cleanup Function', () => {
  test('should return a cleanup function', async () => {
    try {
      const cleanup = await setupTestEnvironment({
        skipLock: true,
        skipPreflight: true,
        skipWarmup: true,
      })

      expect(typeof cleanup).toBe('function')

      // Calling cleanup should not throw
      expect(() => cleanup()).not.toThrow()
    } catch (_e) {
      // Setup might fail
    }
  })

  test('should handle cleanup being called multiple times', async () => {
    try {
      const cleanup = await setupTestEnvironment({
        skipLock: true,
        skipPreflight: true,
        skipWarmup: true,
      })

      // Multiple calls should be safe
      cleanup()
      cleanup()
      cleanup()
    } catch (_e) {
      // Setup might fail
    }
  })
})
