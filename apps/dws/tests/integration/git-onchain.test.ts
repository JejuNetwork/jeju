/**
 * Git Registry On-Chain Integration Tests
 * Tests actual contract deployment and on-chain state verification
 *
 * Run with: bun test tests/integration/git-onchain.test.ts
 * Requires: Localnet running on port 8545
 */

import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getL2RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import { type Address, createPublicClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { GitRepoManager } from '../../api/git/repo-manager'
import { createBackendManager } from '../../api/storage/backends'

setDefaultTimeout(30000)

const RPC_URL =
  (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ||
  getL2RpcUrl() ||
  `http://${getLocalhostHost()}:6546`
const PRIVATE_KEY = ((typeof process !== 'undefined'
  ? process.env.DWS_PRIVATE_KEY
  : undefined) ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex
const SKIP =
  (typeof process !== 'undefined'
    ? process.env.SKIP_INTEGRATION
    : undefined) === 'true'

describe.skipIf(SKIP)('Git Registry On-Chain Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>
  let repoManager: GitRepoManager
  let repoRegistryAddress: Address
  let testAccount: Address

  beforeAll(async () => {
    const account = privateKeyToAccount(PRIVATE_KEY)
    testAccount = account.address

    const chain = {
      ...foundry,
      rpcUrls: {
        default: { http: [RPC_URL] },
      },
    }

    publicClient = createPublicClient({
      chain,
      transport: http(RPC_URL),
    })

    // Get repo registry address from env or use a test address
    repoRegistryAddress = ((typeof process !== 'undefined'
      ? process.env.REPO_REGISTRY_ADDRESS
      : undefined) || '0x0000000000000000000000000000000000000000') as Address

    if (repoRegistryAddress === '0x0000000000000000000000000000000000000000') {
      console.warn(
        '[Git OnChain Test] REPO_REGISTRY_ADDRESS not set, skipping on-chain tests',
      )
      return
    }

    const backend = createBackendManager()
    repoManager = new GitRepoManager(
      {
        rpcUrl: RPC_URL,
        repoRegistryAddress,
        privateKey: PRIVATE_KEY,
      },
      backend,
    )
  })

  test('should read repository count from contract', async () => {
    if (repoRegistryAddress === '0x0000000000000000000000000000000000000000') {
      return
    }

    const count = await repoManager.getRepositoryCount()
    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should verify contract address is valid', async () => {
    if (repoRegistryAddress === '0x0000000000000000000000000000000000000000') {
      return
    }

    // Try to read from contract to verify it exists
    const code = await publicClient.getBytecode({
      address: repoRegistryAddress,
    })
    expect(code).not.toBe('0x')
    expect(code).toBeDefined()
  })

  test('should handle non-existent repository gracefully', async () => {
    if (repoRegistryAddress === '0x0000000000000000000000000000000000000000') {
      return
    }

    const repo = await repoManager.getRepositoryByName(
      '0x0000000000000000000000000000000000000000' as Address,
      'nonexistent-repo-xyz-12345',
    )
    expect(repo).toBeNull()
  })

  test('should validate repository name format', async () => {
    if (repoRegistryAddress === '0x0000000000000000000000000000000000000000') {
      return
    }

    // Test invalid repository names
    await expect(
      repoManager.createRepository(
        { name: '' }, // Empty name
        testAccount,
      ),
    ).rejects.toThrow()

    await expect(
      repoManager.createRepository(
        { name: 'invalid/repo/name' }, // Invalid characters
        testAccount,
      ),
    ).rejects.toThrow()
  })

  test('should validate Git OID format', async () => {
    if (repoRegistryAddress === '0x0000000000000000000000000000000000000000') {
      return
    }

    // Test invalid OIDs
    await expect(
      repoManager.pushBranch(
        '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        'main',
        'invalid-oid', // Invalid OID format
        null,
        1,
        testAccount,
      ),
    ).rejects.toThrow()

    await expect(
      repoManager.pushBranch(
        '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
        'main',
        '123456789012345678901234567890123456789', // Too short
        null,
        1,
        testAccount,
      ),
    ).rejects.toThrow()
  })
})

