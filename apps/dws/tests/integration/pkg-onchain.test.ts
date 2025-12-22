/**
 * Package Registry On-Chain Integration Tests
 * Tests actual contract deployment and on-chain state verification
 *
 * Run with: bun test tests/integration/pkg-onchain.test.ts
 * Requires: Localnet running on port 8545
 */

import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { PkgRegistryManager } from '../../src/pkg/registry-manager'
import { createBackendManager } from '../../src/storage/backends'

setDefaultTimeout(30000)

const RPC_URL = process.env.RPC_URL || 'http://localhost:9545'
const PRIVATE_KEY = (process.env.DWS_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex
const SKIP = process.env.SKIP_INTEGRATION === 'true'

// PackageRegistry ABI (minimal for testing)
const _PACKAGE_REGISTRY_ABI = [
  {
    name: 'createPackage',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'scope', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'license', type: 'string' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ name: 'packageId', type: 'bytes32' }],
  },
  {
    name: 'getPackageByName',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'scope', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'packageId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getPackageCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

describe.skipIf(SKIP)('Package Registry On-Chain Integration', () => {
  let publicClient: ReturnType<typeof createPublicClient>
  let _walletClient: ReturnType<typeof createWalletClient>
  let registryManager: PkgRegistryManager
  let packageRegistryAddress: Address
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

    _walletClient = createWalletClient({
      account,
      chain,
      transport: http(RPC_URL),
    })

    // Get package registry address from env or use a test address
    packageRegistryAddress = (process.env.PACKAGE_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address

    if (
      packageRegistryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      console.warn(
        '[Pkg OnChain Test] PACKAGE_REGISTRY_ADDRESS not set, skipping on-chain tests',
      )
      return
    }

    const backend = createBackendManager()
    registryManager = new PkgRegistryManager(
      {
        rpcUrl: RPC_URL,
        packageRegistryAddress,
        privateKey: PRIVATE_KEY,
      },
      backend,
    )
  })

  test('should read package count from contract', async () => {
    if (
      packageRegistryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      return
    }

    const count = await registryManager.getPackageCount()
    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('should verify contract address is valid', async () => {
    if (
      packageRegistryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      return
    }

    // Try to read from contract to verify it exists
    const code = await publicClient.getBytecode({
      address: packageRegistryAddress,
    })
    expect(code).not.toBe('0x')
    expect(code).toBeDefined()
  })

  test('should handle non-existent package gracefully', async () => {
    if (
      packageRegistryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      return
    }

    const pkg = await registryManager.getPackageByName(
      'nonexistent-package-xyz-12345',
    )
    expect(pkg).toBeNull()
  })

  test('should validate package name format', async () => {
    if (
      packageRegistryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      return
    }

    // Test invalid package names
    await expect(
      registryManager.publish(
        '', // Empty name
        { name: '', version: '1.0.0' },
        Buffer.from('test'),
        testAccount,
      ),
    ).rejects.toThrow()

    await expect(
      registryManager.publish(
        'invalid-package-name-with-very-long-name-that-exceeds-maximum-length-of-214-characters-and-should-fail-validation-12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890',
        { name: 'test', version: '1.0.0' },
        Buffer.from('test'),
        testAccount,
      ),
    ).rejects.toThrow()
  })
})
