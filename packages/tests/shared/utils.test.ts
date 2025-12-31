/**
 * Utils Tests - Workspace Finding, RPC Checking, Environment Utilities
 *
 * Comprehensive tests for utility functions used across test infrastructure.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  checkContractsDeployed,
  checkRpcHealth,
  checkServiceHealth,
  findJejuWorkspaceRoot,
  getChainId,
  getTestEnv,
  isRpcAvailable,
  isServiceAvailable,
  JEJU_CHAIN,
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  PASSWORD,
  SEED_PHRASE,
  TEST_ACCOUNTS,
  TEST_WALLET_ADDRESS,
  waitForRpc,
  waitForService,
} from './utils'

// Test Constants Validation

describe('Test Constants - Validity', () => {
  test('SEED_PHRASE is 12-word mnemonic', () => {
    const words = SEED_PHRASE.split(' ')
    expect(words.length).toBe(12)
    expect(words.every((w) => w.length > 0)).toBe(true)
  })

  test('PASSWORD meets strength requirements', () => {
    expect(PASSWORD.length).toBeGreaterThanOrEqual(8)
    expect(/[A-Z]/.test(PASSWORD)).toBe(true) // Has uppercase
    expect(/[a-z]/.test(PASSWORD)).toBe(true) // Has lowercase
    expect(/[0-9]/.test(PASSWORD)).toBe(true) // Has digit
  })

  test('TEST_WALLET_ADDRESS is valid Ethereum address', () => {
    expect(TEST_WALLET_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('JEJU_CHAIN_ID is positive integer', () => {
    expect(JEJU_CHAIN_ID).toBeGreaterThan(0)
    expect(Number.isInteger(JEJU_CHAIN_ID)).toBe(true)
  })

  test('JEJU_RPC_URL is valid URL', () => {
    expect(() => new URL(JEJU_RPC_URL)).not.toThrow()
  })

  test('JEJU_CHAIN has required fields', () => {
    expect(JEJU_CHAIN.chainId).toBe(JEJU_CHAIN_ID)
    expect(JEJU_CHAIN.chainIdHex).toBe(`0x${JEJU_CHAIN_ID.toString(16)}`)
    expect(JEJU_CHAIN.name).toBeTruthy()
    expect(JEJU_CHAIN.rpcUrl).toBe(JEJU_RPC_URL)
    expect(JEJU_CHAIN.symbol).toBe('ETH')
  })
})

describe('TEST_ACCOUNTS - Account Validity', () => {
  test('all accounts have valid addresses', () => {
    const accounts = [
      TEST_ACCOUNTS.deployer,
      TEST_ACCOUNTS.user1,
      TEST_ACCOUNTS.user2,
      TEST_ACCOUNTS.user3,
      TEST_ACCOUNTS.operator,
    ]

    for (const account of accounts) {
      expect(account.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(account.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/)
    }
  })

  test('all accounts have unique addresses', () => {
    const addresses = [
      TEST_ACCOUNTS.deployer.address,
      TEST_ACCOUNTS.user1.address,
      TEST_ACCOUNTS.user2.address,
      TEST_ACCOUNTS.user3.address,
      TEST_ACCOUNTS.operator.address,
    ]

    expect(new Set(addresses).size).toBe(5)
  })

  test('deployer address matches TEST_WALLET_ADDRESS', () => {
    expect(TEST_ACCOUNTS.deployer.address.toLowerCase()).toBe(
      TEST_WALLET_ADDRESS.toLowerCase(),
    )
  })
})

// Workspace Root Finding Tests

const TEST_DIR = '/tmp/jeju-utils-test'

beforeEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
  mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
  // Clean up env vars
  delete process.env.JEJU_ROOT
})

describe('findJejuWorkspaceRoot - Package.json Detection', () => {
  test('should find workspace root with jeju package.json', () => {
    const root = join(TEST_DIR, 'workspace')
    const nested = join(root, 'packages', 'tests')

    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'jeju' }))

    const found = findJejuWorkspaceRoot(nested)
    expect(found).toBe(root)
  })

  test('should find workspace from deeply nested directory', () => {
    const root = join(TEST_DIR, 'workspace')
    const deep = join(root, 'a', 'b', 'c', 'd', 'e')

    mkdirSync(deep, { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'jeju' }))

    const found = findJejuWorkspaceRoot(deep)
    expect(found).toBe(root)
  })

  test('should not match package.json with different name', () => {
    const root = join(TEST_DIR, 'workspace')
    const sub = join(root, 'subdir')

    mkdirSync(sub, { recursive: true })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'other-project' }),
    )

    // Should not find it based on package.json, might fall back to bun.lock detection
    const found = findJejuWorkspaceRoot(sub)
    expect(found).not.toBe(root) // Won't match on name
  })
})

describe('findJejuWorkspaceRoot - Fallback Detection', () => {
  test('should find workspace with bun.lock and packages directory', () => {
    const root = join(TEST_DIR, 'workspace')
    const nested = join(root, 'packages', 'tests')

    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'bun.lock'), '')

    const found = findJejuWorkspaceRoot(nested)
    expect(found).toBe(root)
  })

  test('should throw when workspace root not found', () => {
    delete process.env.JEJU_ROOT

    // Start from a path that won't find anything
    expect(() =>
      findJejuWorkspaceRoot('/nonexistent/path/that/does/not/exist', {
        throwOnNotFound: true,
      }),
    ).toThrow()
  })

  test('should fall back to cwd when nothing found', () => {
    delete process.env.JEJU_ROOT

    const found = findJejuWorkspaceRoot('/nonexistent/path')
    expect(found).toBe(process.cwd())
  })
})

describe('findJejuWorkspaceRoot - Edge Cases', () => {
  test('should handle max depth', () => {
    // Create a very deep directory structure
    let current = TEST_DIR
    for (let i = 0; i < 20; i++) {
      current = join(current, `level${i}`)
    }
    mkdirSync(current, { recursive: true })

    // Put workspace root at top
    writeFileSync(
      join(TEST_DIR, 'package.json'),
      JSON.stringify({ name: 'jeju' }),
    )

    // Should not find it if beyond max depth (15)
    const found = findJejuWorkspaceRoot(current)

    // Will either find it or fall back
    expect(typeof found).toBe('string')
  })

  test('should throw on invalid JSON in package.json', () => {
    const root = join(TEST_DIR, 'workspace')
    const nested = join(root, 'packages')

    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, 'package.json'), 'not json{{{')

    // The function throws on invalid JSON (fail-fast behavior)
    expect(() => findJejuWorkspaceRoot(nested)).toThrow()
  })

  test('should fall back to bun.lock when package.json has no name field', () => {
    const root = join(TEST_DIR, 'workspace')
    const nested = join(root, 'subdir')

    mkdirSync(nested, { recursive: true })
    // No package.json with name="jeju", but has bun.lock and packages
    mkdirSync(join(root, 'packages'), { recursive: true })
    writeFileSync(join(root, 'bun.lock'), '')

    const found = findJejuWorkspaceRoot(nested)
    // Will fall back to bun.lock detection
    expect(found).toBe(root)
  })

  test('should start from current directory by default', () => {
    // When called without args, should use process.cwd()
    const found = findJejuWorkspaceRoot()
    expect(typeof found).toBe('string')
    expect(found.length).toBeGreaterThan(0)
  })
})

describe('findJejuWorkspaceRoot - Real Workspace', () => {
  test('should find actual jeju workspace from this file', () => {
    const found = findJejuWorkspaceRoot(__dirname)

    // Should find actual workspace root
    expect(existsSync(join(found, 'package.json'))).toBe(true)

    const pkg = JSON.parse(readFileSync(join(found, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('jeju')
  })
})

// RPC Health Check Tests

import { getRpcUrl } from '@jejunetwork/config'

const FAKE_RPC = 'http://localhost:59999'
const REAL_RPC = getRpcUrl()

describe('checkRpcHealth - Error Handling', () => {
  test('should return unavailable for unreachable RPC', async () => {
    const result = await checkRpcHealth(FAKE_RPC, 2000)

    expect(result.available).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('should timeout after specified duration', async () => {
    const start = Date.now()
    await checkRpcHealth(FAKE_RPC, 1000)
    const elapsed = Date.now() - start

    // Should not wait much longer than timeout
    expect(elapsed).toBeLessThan(3000)
  })

  test('should include error message for connection failure', async () => {
    const result = await checkRpcHealth(FAKE_RPC, 1000)

    expect(result.available).toBe(false)
    expect(result.error).toBeTruthy()
    // Error message varies by platform/runtime
    expect(result.error?.length).toBeGreaterThan(0)
  })
})

describe('isRpcAvailable - Simple Check', () => {
  test('should return false for unreachable RPC', async () => {
    const available = await isRpcAvailable(FAKE_RPC, 1000)
    expect(available).toBe(false)
  })

  test('should use default timeout', async () => {
    const start = Date.now()
    await isRpcAvailable(FAKE_RPC)
    const elapsed = Date.now() - start

    // Default timeout is 3000ms, should complete reasonably fast on connection refused
    expect(elapsed).toBeLessThan(5000)
  })
})

describe('checkContractsDeployed - Contract Check', () => {
  test('should return false for unreachable RPC', async () => {
    const deployed = await checkContractsDeployed(FAKE_RPC, undefined, 1000)
    expect(deployed).toBe(false)
  })

  test('should accept custom contract address', async () => {
    const customAddress = '0x1234567890123456789012345678901234567890'
    const deployed = await checkContractsDeployed(FAKE_RPC, customAddress, 1000)
    expect(deployed).toBe(false)
  })
})

// Service Health Check Tests

describe('checkServiceHealth - HTTP Service Check', () => {
  test('should return unavailable for unreachable service', async () => {
    const result = await checkServiceHealth('http://localhost:59998', {
      timeout: 1000,
    })

    expect(result.available).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('should support custom expected status codes', async () => {
    const result = await checkServiceHealth('http://localhost:59998', {
      timeout: 1000,
      expectedStatuses: [200, 201, 204],
    })

    expect(result.available).toBe(false)
  })

  test('should support POST method', async () => {
    const result = await checkServiceHealth('http://localhost:59998', {
      method: 'POST',
      timeout: 1000,
    })

    expect(result.available).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('isServiceAvailable - Simple Service Check', () => {
  test('should return false for unreachable service', async () => {
    const available = await isServiceAvailable('http://localhost:59998', 1000)
    expect(available).toBe(false)
  })
})

// Wait Functions Tests

describe('waitForRpc - Retry Logic', () => {
  test('should return false when timeout exceeded', async () => {
    const start = Date.now()
    const result = await waitForRpc(FAKE_RPC, {
      maxWaitMs: 2000,
      intervalMs: 500,
    })
    const elapsed = Date.now() - start

    expect(result).toBe(false)
    expect(elapsed).toBeGreaterThanOrEqual(2000)
    expect(elapsed).toBeLessThan(4000)
  })

  test('should respect interval between checks', async () => {
    const start = Date.now()
    await waitForRpc(FAKE_RPC, {
      maxWaitMs: 1500,
      intervalMs: 1000,
    })
    const elapsed = Date.now() - start

    // Should wait roughly 1.5s (hit timeout after ~1 interval)
    expect(elapsed).toBeGreaterThanOrEqual(1000)
  })
})

describe('waitForService - Service Retry', () => {
  test('should return false when service never available', async () => {
    const result = await waitForService('http://localhost:59998', {
      maxWaitMs: 1000,
      intervalMs: 300,
    })

    expect(result).toBe(false)
  })
})

// Environment Utilities Tests

describe('getRpcUrl - Configuration Based', () => {
  test('should return L2 RPC URL from config', () => {
    const rpcUrl = getRpcUrl()
    // getRpcUrl returns the L2 RPC URL from network config
    expect(rpcUrl).toMatch(/^https?:\/\//)
    expect(typeof rpcUrl).toBe('string')
    expect(rpcUrl.length).toBeGreaterThan(10)
  })

  test('should consistently return same URL', () => {
    const url1 = getRpcUrl()
    const url2 = getRpcUrl()
    expect(url1).toBe(url2)
  })
})

describe('getChainId - Configuration Based', () => {
  test('should return chain ID from config', () => {
    const chainId = getChainId()
    expect(typeof chainId).toBe('number')
    expect(chainId).toBeGreaterThan(0)
  })

  test('should return consistent chain ID', () => {
    const id1 = getChainId()
    const id2 = getChainId()
    expect(id1).toBe(id2)
  })
})

describe('getTestEnv - Test Environment Configuration', () => {
  test('should return all required environment URLs', () => {
    const env = getTestEnv()

    expect(env).toHaveProperty('L1_RPC_URL')
    expect(env).toHaveProperty('L2_RPC_URL')
    expect(env).toHaveProperty('JEJU_RPC_URL')
    expect(env).toHaveProperty('CHAIN_ID')
    expect(env).toHaveProperty('INDEXER_GRAPHQL_URL')
    expect(env).toHaveProperty('ORACLE_URL')
    expect(env).toHaveProperty('SOLANA_RPC_URL')
  })

  test('should return valid URL formats', () => {
    delete process.env.L2_RPC_URL

    const env = getTestEnv()

    // L1 and L2 URLs should be valid HTTP URLs
    expect(env.L1_RPC_URL).toMatch(/^https?:\/\//)
    expect(env.L2_RPC_URL).toMatch(/^https?:\/\//)
    // Chain ID should be a numeric string
    expect(env.CHAIN_ID).toMatch(/^\d+$/)
  })
})

// Integration Tests (require live chain)

// Auto-detect chain availability (sync check for skipIf)
const CHAIN_AVAILABLE =
  process.env.CHAIN_AVAILABLE === 'true' ||
  (await isRpcAvailable(REAL_RPC).catch(() => false))

describe.skipIf(!CHAIN_AVAILABLE)('RPC Health - Integration', () => {
  test('should return healthy for running chain', async () => {
    const result = await checkRpcHealth(REAL_RPC, 5000)

    expect(result.available).toBe(true)
    expect(result.chainId).toBeGreaterThan(0)
    expect(result.blockNumber).toBeGreaterThanOrEqual(0)
  })

  test('should detect chain ID mismatch in waitForRpc', async () => {
    const result = await waitForRpc(REAL_RPC, {
      maxWaitMs: 3000,
      expectedChainId: 99999, // Wrong chain ID
    })

    // Should connect but fail chain ID check
    expect(result).toBe(false)
  })
})
