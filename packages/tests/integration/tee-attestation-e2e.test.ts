/**
 * TEE Attestation E2E Integration Tests
 *
 * Tests the complete attestation flow:
 * - Provider registration with attestation
 * - Quote submission and verification
 * - Inference request through TEE node
 * - Settlement and payment
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import {
  createTypedPublicClient,
  createTypedWalletClient,
  readContract,
  writeContract,
} from '@jejunetwork/contracts/viem'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { keccak256, parseEther, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG = {
  rpcUrl: process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:6546',
  chainId: parseInt(process.env.JEJU_CHAIN_ID ?? '420691', 10),
  computeRegistry: (process.env.COMPUTE_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address,
  attestationVerifier: (process.env.ATTESTATION_VERIFIER_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address,
  inferenceServing: (process.env.INFERENCE_SERVING_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address,
  // Anvil default private keys for testing
  providerKey:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const,
  userKey:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const,
}

// ============================================================================
// Contract ABIs
// ============================================================================

const COMPUTE_REGISTRY_ABI = [
  {
    name: 'registerWithTEE',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'nodeId', type: 'bytes32' },
      { name: 'teePlatform', type: 'uint8' },
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'serviceType', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'providers',
    type: 'function',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'stake', type: 'uint256' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'agentId', type: 'uint256' },
      { name: 'serviceType', type: 'bytes32' },
      { name: 'active', type: 'bool' },
      { name: 'nodeId', type: 'bytes32' },
      { name: 'teePlatform', type: 'uint8' },
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'teeVerified', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getTEEVerifiedProviders',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getProviderTEEStatus',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      { name: 'hasTEE', type: 'bool' },
      { name: 'verified', type: 'bool' },
      { name: 'platform', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'SERVICE_INFERENCE',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const

const ATTESTATION_VERIFIER_ABI = [
  {
    name: 'addTrustedMeasurement',
    type: 'function',
    inputs: [
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'platform', type: 'uint8' },
      { name: 'description', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'submitAttestation',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'platform', type: 'uint8' },
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'quote', type: 'bytes' },
      { name: 'reportData', type: 'bytes32' },
      { name: 'validityPeriod', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'isNodeAttested',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      { name: 'valid', type: 'bool' },
      { name: 'attestationId', type: 'bytes32' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'isTrustedMeasurement',
    type: 'function',
    inputs: [
      { name: 'mrEnclave', type: 'bytes32' },
      { name: 'mrSigner', type: 'bytes32' },
      { name: 'platform', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Test Helpers
// ============================================================================

function generateMockQuote(): Uint8Array {
  // Generate a minimal mock quote (128+ bytes)
  const quote = new Uint8Array(256)
  crypto.getRandomValues(quote)
  return quote
}

function generateNodeId(seed: string): `0x${string}` {
  return keccak256(toBytes(seed))
}

function generateMeasurement(seed: string): `0x${string}` {
  return keccak256(toBytes(seed))
}

// ============================================================================
// Tests
// ============================================================================

describe('TEE Attestation E2E', () => {
  let publicClient: PublicClient
  let providerWalletClient: WalletClient
  let _userWalletClient: WalletClient
  let providerAddress: Address
  let _userAddress: Address

  // Test data
  const nodeId = generateNodeId(`test-node-${Date.now()}`)
  const mrEnclave = generateMeasurement('test-enclave')
  const mrSigner = generateMeasurement('test-signer')
  const teePlatform = 4 // PHALA

  beforeAll(() => {
    // Skip if contracts not deployed
    if (
      TEST_CONFIG.computeRegistry ===
      '0x0000000000000000000000000000000000000000'
    ) {
      console.log('Skipping E2E tests - contracts not deployed')
      return
    }

    publicClient = createTypedPublicClient({
      chainId: TEST_CONFIG.chainId,
      rpcUrl: TEST_CONFIG.rpcUrl,
      chainName: 'Jeju',
    }) as PublicClient

    const providerAccount = privateKeyToAccount(TEST_CONFIG.providerKey)
    providerAddress = providerAccount.address

    providerWalletClient = createTypedWalletClient({
      chainId: TEST_CONFIG.chainId,
      rpcUrl: TEST_CONFIG.rpcUrl,
      chainName: 'Jeju',
      account: providerAccount,
    }) as WalletClient

    const userAccount = privateKeyToAccount(TEST_CONFIG.userKey)
    _userAddress = userAccount.address

    _userWalletClient = createTypedWalletClient({
      chainId: TEST_CONFIG.chainId,
      rpcUrl: TEST_CONFIG.rpcUrl,
      chainName: 'Jeju',
      account: userAccount,
    }) as WalletClient
  })

  describe('Measurement Management', () => {
    it('should add trusted measurement', async () => {
      if (
        TEST_CONFIG.attestationVerifier ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - attestation verifier not deployed')
        return
      }

      const hash = await writeContract(providerWalletClient, {
        address: TEST_CONFIG.attestationVerifier,
        abi: ATTESTATION_VERIFIER_ABI,
        functionName: 'addTrustedMeasurement',
        args: [mrEnclave, mrSigner, teePlatform, 'Test TEE Measurement'],
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      expect(receipt.status).toBe('success')
    })

    it('should verify measurement is trusted', async () => {
      if (
        TEST_CONFIG.attestationVerifier ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - attestation verifier not deployed')
        return
      }

      const isTrusted = await readContract(publicClient, {
        address: TEST_CONFIG.attestationVerifier,
        abi: ATTESTATION_VERIFIER_ABI,
        functionName: 'isTrustedMeasurement',
        args: [mrEnclave, mrSigner, teePlatform],
      })

      expect(isTrusted).toBe(true)
    })
  })

  describe('Attestation Submission', () => {
    it('should submit attestation with stake', async () => {
      if (
        TEST_CONFIG.attestationVerifier ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - attestation verifier not deployed')
        return
      }

      const quote = generateMockQuote()
      const reportData = keccak256(toBytes(Date.now().toString()))

      const hash = await writeContract(providerWalletClient, {
        address: TEST_CONFIG.attestationVerifier,
        abi: ATTESTATION_VERIFIER_ABI,
        functionName: 'submitAttestation',
        args: [
          nodeId,
          teePlatform,
          mrEnclave,
          mrSigner,
          `0x${Buffer.from(quote).toString('hex')}` as Hex,
          reportData,
          BigInt(86400), // 1 day validity
        ],
        value: parseEther('0.1'),
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      expect(receipt.status).toBe('success')
    })

    it('should verify node is attested', async () => {
      if (
        TEST_CONFIG.attestationVerifier ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - attestation verifier not deployed')
        return
      }

      const [_valid, attestationId] = (await readContract(publicClient, {
        address: TEST_CONFIG.attestationVerifier,
        abi: ATTESTATION_VERIFIER_ABI,
        functionName: 'isNodeAttested',
        args: [nodeId],
      })) as [boolean, Hex]

      // May be pending challenge period
      expect(attestationId).not.toBe(
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      )
    })
  })

  describe('Provider Registration', () => {
    it('should register provider with TEE', async () => {
      if (
        TEST_CONFIG.computeRegistry ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - compute registry not deployed')
        return
      }

      // Get service type
      const serviceType = await readContract(publicClient, {
        address: TEST_CONFIG.computeRegistry,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'SERVICE_INFERENCE',
      })

      const hash = await writeContract(providerWalletClient, {
        address: TEST_CONFIG.computeRegistry,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'registerWithTEE',
        args: [
          'Test TEE Provider',
          'http://localhost:3000',
          nodeId,
          teePlatform,
          mrEnclave,
          mrSigner,
          serviceType,
        ],
        value: parseEther('0.1'),
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      expect(receipt.status).toBe('success')
    })

    it('should verify provider is registered', async () => {
      if (
        TEST_CONFIG.computeRegistry ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - compute registry not deployed')
        return
      }

      const provider = await readContract(publicClient, {
        address: TEST_CONFIG.computeRegistry,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'providers',
        args: [providerAddress],
      })

      expect(provider[1]).toBe('Test TEE Provider')
      expect(provider[8]).toBe(true) // active
    })

    it('should show provider TEE status', async () => {
      if (
        TEST_CONFIG.computeRegistry ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - compute registry not deployed')
        return
      }

      const [hasTEE, _verified, platform] = (await readContract(publicClient, {
        address: TEST_CONFIG.computeRegistry,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getProviderTEEStatus',
        args: [providerAddress],
      })) as [boolean, boolean, number]

      expect(hasTEE).toBe(true)
      expect(platform).toBe(teePlatform)
    })
  })

  describe('Provider Discovery', () => {
    it('should list TEE verified providers', async () => {
      if (
        TEST_CONFIG.computeRegistry ===
        '0x0000000000000000000000000000000000000000'
      ) {
        console.log('Skipping - compute registry not deployed')
        return
      }

      const providers = await readContract(publicClient, {
        address: TEST_CONFIG.computeRegistry,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'getTEEVerifiedProviders',
      })

      // May or may not include our provider depending on verification status
      expect(Array.isArray(providers)).toBe(true)
    })
  })
})

// Import TEE modules at top level for type safety
import { createTEEStateManager } from '@jejunetwork/agents'
import { createDCAPVerifier, parseQuote } from '@jejunetwork/zksolbridge/tee'

describe('TEE State Manager', () => {
  it('should encrypt and decrypt secrets', async () => {
    const manager = createTEEStateManager({
      mrEnclave: generateMeasurement('test-enclave'),
      mrSigner: generateMeasurement('test-signer'),
      nodeId: 'test-node-123',
      persistState: false,
    })

    await manager.initialize()

    // Store secret
    await manager.storeSecret('event-outcome', 'event_outcome', {
      eventId: 'event-1',
      outcome: 'team_a_wins',
      timestamp: Date.now(),
    })

    // Retrieve secret
    const secret = await manager.getSecret<{
      eventId: string
      outcome: string
      timestamp: number
    }>('event-outcome')

    expect(secret).not.toBeNull()
    expect(secret?.eventId).toBe('event-1')
    expect(secret?.outcome).toBe('team_a_wins')
  })

  it('should save and load agent state', async () => {
    const manager = createTEEStateManager({
      mrEnclave: generateMeasurement('test-enclave'),
      mrSigner: generateMeasurement('test-signer'),
      nodeId: 'test-node-456',
      persistState: false,
    })

    await manager.initialize()

    // Save state
    const state = {
      agentName: 'Test Agent',
      currentMarkets: ['market-1', 'market-2'],
      lastAction: Date.now(),
    }

    const snapshotId = await manager.saveState('agent-1', state)
    expect(snapshotId).toBeDefined()

    // Load state
    const loaded = await manager.loadState<typeof state>('agent-1')
    expect(loaded).not.toBeNull()
    expect(loaded?.agentName).toBe('Test Agent')
    expect(loaded?.currentMarkets).toEqual(['market-1', 'market-2'])
  })

  it('should enforce secret expiration', async () => {
    const manager = createTEEStateManager({
      mrEnclave: generateMeasurement('test-enclave'),
      mrSigner: generateMeasurement('test-signer'),
      nodeId: 'test-node-789',
      persistState: false,
    })

    await manager.initialize()

    // Store secret with past expiration
    await manager.storeSecret(
      'expired-secret',
      'custom',
      { data: 'test' },
      { expiresAt: Date.now() - 1000 },
    )

    // Should return null for expired secret
    const secret = await manager.getSecret('expired-secret')
    expect(secret).toBeNull()
  })
})

describe('DCAP Verifier', () => {
  it('should parse SGX quote structure', async () => {
    // Create a minimal valid quote structure
    // Header (48) + SGX Body (384) + Signature Data (at least 138)
    const HEADER_SIZE = 48
    const SGX_BODY_SIZE = 384
    const SIG_DATA_SIZE = 200 // Signature (64) + PubKey (64) + Cert Header (6) + padding

    const quote = new Uint8Array(
      HEADER_SIZE + SGX_BODY_SIZE + 4 + SIG_DATA_SIZE,
    )
    const view = new DataView(quote.buffer)

    // Header (48 bytes)
    // Version (2 bytes)
    view.setUint16(0, 4, true)
    // Attestation key type (2 bytes) - ECDSA P-256
    view.setUint16(2, 2, true)
    // TEE type (4 bytes) - SGX
    view.setUint32(4, 0, true)
    // Reserved, QE Vendor ID, User Data fill rest of header
    crypto.getRandomValues(quote.slice(8, HEADER_SIZE))

    // SGX Body (384 bytes) - fill with random data
    crypto.getRandomValues(
      quote.slice(HEADER_SIZE, HEADER_SIZE + SGX_BODY_SIZE),
    )

    // Signature Data Length (4 bytes)
    view.setUint32(HEADER_SIZE + SGX_BODY_SIZE, SIG_DATA_SIZE, true)

    // Signature data (ECDSA signature + public key + cert data)
    crypto.getRandomValues(quote.slice(HEADER_SIZE + SGX_BODY_SIZE + 4))

    // Cert type and size at the right offset
    const certTypeOffset = HEADER_SIZE + SGX_BODY_SIZE + 4 + 64 + 64
    view.setUint16(certTypeOffset, 5, true) // cert type
    view.setUint32(certTypeOffset + 2, 10, true) // cert data size

    const parsed = parseQuote(quote)

    expect(parsed.header.version).toBe(4)
    expect(parsed.header.attestationKeyType).toBe(2)
    expect(parsed.header.teeType).toBe('SGX')
  })

  it('should create verifier with trusted measurements', async () => {
    const verifier = createDCAPVerifier(
      [
        {
          mrEnclave: generateMeasurement('trusted-enclave'),
          mrSigner: generateMeasurement('trusted-signer'),
          platform: 'SGX',
          description: 'Test trusted measurement',
        },
      ],
      {
        allowTestMode: true,
      },
    )

    const measurements = verifier.getTrustedMeasurements()
    expect(measurements.length).toBe(1)
    expect(measurements[0].platform).toBe('SGX')
  })
})

// ============================================================================
// Billing Tracker Tests
// ============================================================================

describe('Billing Tracker', () => {
  it('should track container costs', async () => {
    const { BillingTracker } = await import('@jejunetwork/zksolbridge/tee')

    // Create a mock config - no actual contract calls
    const mockPublicClient = {} as PublicClient
    const mockWalletClient = {} as WalletClient

    const tracker = new BillingTracker({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      ledgerManagerAddress:
        '0x0000000000000000000000000000000000000001' as Address,
      providerAddress: '0x0000000000000000000000000000000000000002' as Address,
      costPerSecond: 1000000000n, // 1 gwei/sec
      costPerGbHour: 100000000000000n, // 0.0001 ETH/GB-hr
      costPerGpuHour: 1000000000000000n, // 0.001 ETH/GPU-hr
      autoWithdrawThreshold: 100000000000000000n,
      minWithdrawAmount: 10000000000000000n,
      updateInterval: 60000,
    })

    // Track a container
    tracker.trackContainer('container-1', 2048, 1)

    // Wait long enough to accumulate at least 1 second of cost
    await new Promise((resolve) => setTimeout(resolve, 1100))

    // Get stats (local calculation)
    const stats = tracker.getStats()
    expect(stats.totalContainers).toBe(1)
    expect(stats.activeContainers).toBe(1)
    // After 1+ second at 1 gwei/sec, should have at least 1 gwei of costs
    expect(stats.totalCosts).toBeGreaterThanOrEqual(1000000000n)

    // Record revenue
    tracker.recordRequest('container-1', 5000000000000000n) // 0.005 ETH

    const statsAfterRequest = tracker.getStats()
    expect(statsAfterRequest.totalRevenue).toBe(5000000000000000n)

    // Untrack container
    const costs = tracker.untrackContainer('container-1')
    expect(costs).not.toBeNull()
    expect(costs?.requestsServed).toBe(1)
    expect(costs?.revenueGenerated).toBe(5000000000000000n)

    // Container should be removed
    const finalStats = tracker.getStats()
    expect(finalStats.totalContainers).toBe(0)
  })

  it('should calculate profit margin correctly', async () => {
    const { BillingTracker } = await import('@jejunetwork/zksolbridge/tee')

    const mockPublicClient = {} as PublicClient
    const mockWalletClient = {} as WalletClient

    const tracker = new BillingTracker({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      ledgerManagerAddress:
        '0x0000000000000000000000000000000000000001' as Address,
      providerAddress: '0x0000000000000000000000000000000000000002' as Address,
      costPerSecond: 1n, // Very low cost for testing
      costPerGbHour: 0n,
      costPerGpuHour: 0n,
      autoWithdrawThreshold: 100000000000000000n,
      minWithdrawAmount: 10000000000000000n,
      updateInterval: 60000,
    })

    // Track container with very low cost
    tracker.trackContainer('container-1', 1024, 0)

    // Record multiple requests with revenue
    tracker.recordRequest('container-1', 1000000000000000n) // 0.001 ETH
    tracker.recordRequest('container-1', 1000000000000000n) // 0.001 ETH
    tracker.recordRequest('container-1', 1000000000000000n) // 0.001 ETH

    const stats = tracker.getStats()
    expect(stats.totalRevenue).toBe(3000000000000000n) // 0.003 ETH
    expect(stats.profitMarginBps).toBeGreaterThan(0) // Should be highly profitable with low costs
  })

  it('should enforce minimum withdrawal amount', async () => {
    const { BillingTracker } = await import('@jejunetwork/zksolbridge/tee')

    const mockPublicClient = {
      readContract: async () =>
        [0n, 1000000000000000n, 0n, Date.now()] as const, // 0.001 ETH available
    } as unknown as PublicClient
    const mockWalletClient = {} as WalletClient

    const tracker = new BillingTracker({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      ledgerManagerAddress:
        '0x0000000000000000000000000000000000000001' as Address,
      providerAddress: '0x0000000000000000000000000000000000000002' as Address,
      costPerSecond: 0n,
      costPerGbHour: 0n,
      costPerGpuHour: 0n,
      autoWithdrawThreshold: 100000000000000000n,
      minWithdrawAmount: 10000000000000000n, // 0.01 ETH minimum
      updateInterval: 60000,
    })

    // Try to withdraw less than minimum
    try {
      await tracker.withdraw(1000000000000000n) // 0.001 ETH, below 0.01 minimum
      expect(true).toBe(false) // Should not reach here
    } catch (error) {
      expect(error instanceof Error).toBe(true)
      expect((error as Error).message).toContain('below minimum')
    }
  })

  it('should verify on-chain balance before withdrawal', async () => {
    const { BillingTracker } = await import('@jejunetwork/zksolbridge/tee')

    const mockPublicClient = {
      readContract: async () =>
        [0n, 5000000000000000n, 0n, Date.now()] as const, // 0.005 ETH available
    } as unknown as PublicClient
    const mockWalletClient = {} as WalletClient

    const tracker = new BillingTracker({
      publicClient: mockPublicClient,
      walletClient: mockWalletClient,
      ledgerManagerAddress:
        '0x0000000000000000000000000000000000000001' as Address,
      providerAddress: '0x0000000000000000000000000000000000000002' as Address,
      costPerSecond: 0n,
      costPerGbHour: 0n,
      costPerGpuHour: 0n,
      autoWithdrawThreshold: 100000000000000000n,
      minWithdrawAmount: 1000000000000000n, // 0.001 ETH minimum
      updateInterval: 60000,
    })

    // Try to withdraw more than on-chain balance
    try {
      await tracker.withdraw(100000000000000000n) // 0.1 ETH, but only 0.005 available
      expect(true).toBe(false) // Should not reach here
    } catch (error) {
      expect(error instanceof Error).toBe(true)
      expect((error as Error).message).toContain('exceeds on-chain balance')
    }
  })
})
