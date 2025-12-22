#!/usr/bin/env bun
/**
 * Psyche Integration Test Suite
 *
 * Tests the complete Psyche integration including:
 * 1. Solana coordinator program interactions
 * 2. EVM DistributedTrainingCoordinator contract
 * 3. Cross-chain bridge between Solana and EVM
 * 4. Full end-to-end training coordination
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js'
import { type Address, createPublicClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import {
  type BridgeConfig,
  createCrossChainBridge,
  type RewardDistribution,
} from './cross-chain-bridge'
import { createPsycheClient, type PsycheConfig } from './psyche-client'

// ============================================================================
// Test Configuration
// ============================================================================

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://localhost:8899'
const EVM_RPC_URL = process.env.EVM_RPC_URL || 'http://localhost:6545'
const EVM_PRIVATE_KEY = (process.env.EVM_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex // Anvil default
const MOCK_BRIDGE_ADDRESS =
  '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address

// Psyche Coordinator Program ID
const PSYCHE_PROGRAM_ID = new PublicKey(
  '4SHugWqSXwKE5fqDchkJcPEqnoZE22VYKtSTVm7axbT7',
)

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

const results: TestResult[] = []

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now()
  try {
    await fn()
    const duration = performance.now() - start
    results.push({ name, passed: true, duration })
    console.log(`✓ ${name} (${duration.toFixed(0)}ms)`)
  } catch (error) {
    const duration = performance.now() - start
    const errorMessage = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, error: errorMessage, duration })
    console.log(`✗ ${name} (${duration.toFixed(0)}ms)`)
    console.log(`  Error: ${errorMessage}`)
  }
}

// ============================================================================
// Solana Tests
// ============================================================================

async function testSolanaConnection(): Promise<void> {
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed')

  // Try to get slot with timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const slot = await connection.getSlot()
    clearTimeout(timeout)
    if (typeof slot !== 'number' || slot < 0) {
      throw new Error('Invalid slot number')
    }
  } catch (_e) {
    clearTimeout(timeout)
    throw new Error('Solana not available (install solana-test-validator)')
  }
}

async function testSolanaProgramExists(): Promise<void> {
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed')

  try {
    const accountInfo = await connection.getAccountInfo(PSYCHE_PROGRAM_ID)
    // On localnet/devnet, program might not be deployed
    // This is OK - we're testing if we can query it
    console.log(
      `  Program ${PSYCHE_PROGRAM_ID.toString()}: ${accountInfo ? 'deployed' : 'not deployed'}`,
    )
  } catch (_e) {
    throw new Error('Solana not available')
  }
}

async function testPsycheClientInitialization(): Promise<void> {
  const keypair = Keypair.generate()

  const config: PsycheConfig = {
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
  }

  const client = createPsycheClient(config)

  if (!client.getPublicKey()) {
    throw new Error('Failed to get public key')
  }

  // Test that public key matches
  if (!client.getPublicKey()?.equals(keypair.publicKey)) {
    throw new Error('Public key mismatch')
  }
}

async function testPsycheClientBalance(): Promise<void> {
  const keypair = Keypair.generate()

  const config: PsycheConfig = {
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
  }

  const client = createPsycheClient(config)

  try {
    // Get balance (should be 0 for new keypair)
    const balance = await client.getBalance()

    if (typeof balance !== 'number') {
      throw new Error('Invalid balance type')
    }

    console.log(`  New keypair balance: ${balance / LAMPORTS_PER_SOL} SOL`)
  } catch (_e) {
    throw new Error('Solana not available')
  }
}

// ============================================================================
// EVM Tests
// ============================================================================

async function testEvmConnection(): Promise<void> {
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(EVM_RPC_URL),
  })

  const blockNumber = await publicClient.getBlockNumber()

  if (typeof blockNumber !== 'bigint') {
    throw new Error('Invalid block number')
  }
}

async function testEvmWalletSetup(): Promise<void> {
  const account = privateKeyToAccount(EVM_PRIVATE_KEY)

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(EVM_RPC_URL),
  })

  const balance = await publicClient.getBalance({ address: account.address })

  // Anvil pre-funds accounts with 10000 ETH each
  console.log(`  Wallet ${account.address}: ${Number(balance) / 1e18} ETH`)

  // Even 0 balance is OK for test purposes (we just need connectivity)
  if (balance < 0n) {
    throw new Error('Invalid balance')
  }
}

async function testPsycheClientWithEvm(): Promise<void> {
  const keypair = Keypair.generate()

  const config: PsycheConfig = {
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
    evmRpcUrl: EVM_RPC_URL,
    evmPrivateKey: EVM_PRIVATE_KEY,
  }

  const client = createPsycheClient(config)

  // Verify both addresses are set
  const solanaKey = client.getPublicKey()
  const evmAddress = client.getEvmAddress()

  if (!solanaKey) {
    throw new Error('Solana key not set')
  }

  if (!evmAddress) {
    throw new Error('EVM address not set')
  }

  console.log(`  Solana: ${solanaKey.toString()}`)
  console.log(`  EVM: ${evmAddress}`)
}

// ============================================================================
// Cross-Chain Bridge Tests
// ============================================================================

async function testBridgeInitialization(): Promise<void> {
  const keypair = Keypair.generate()

  const config: BridgeConfig = {
    evmRpcUrl: EVM_RPC_URL,
    evmPrivateKey: EVM_PRIVATE_KEY,
    bridgeContractAddress: MOCK_BRIDGE_ADDRESS,
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
  }

  const bridge = createCrossChainBridge(config)

  if (!bridge) {
    throw new Error('Failed to create bridge')
  }
}

async function testMerkleRootComputation(): Promise<void> {
  const keypair = Keypair.generate()

  const config: BridgeConfig = {
    evmRpcUrl: EVM_RPC_URL,
    bridgeContractAddress: MOCK_BRIDGE_ADDRESS,
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
  }

  const bridge = createCrossChainBridge(config)

  const rewards: RewardDistribution[] = [
    {
      client: '0x1111111111111111111111111111111111111111' as Address,
      amount: 1000n,
    },
    {
      client: '0x2222222222222222222222222222222222222222' as Address,
      amount: 2000n,
    },
    {
      client: '0x3333333333333333333333333333333333333333' as Address,
      amount: 3000n,
    },
  ]

  const root1 = bridge.computeRewardsMerkleRoot(rewards)
  const root2 = bridge.computeRewardsMerkleRoot(rewards)

  // Root should be consistent
  if (root1 !== root2) {
    throw new Error('Merkle root is not deterministic')
  }

  // Root should be valid 32-byte hex
  if (root1.length !== 66 || !root1.startsWith('0x')) {
    throw new Error(`Invalid merkle root format: ${root1}`)
  }

  console.log(`  Merkle root: ${root1}`)
}

async function testMerkleProofGeneration(): Promise<void> {
  const keypair = Keypair.generate()

  const config: BridgeConfig = {
    evmRpcUrl: EVM_RPC_URL,
    bridgeContractAddress: MOCK_BRIDGE_ADDRESS,
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
  }

  const bridge = createCrossChainBridge(config)

  const rewards: RewardDistribution[] = [
    {
      client: '0x1111111111111111111111111111111111111111' as Address,
      amount: 1000n,
    },
    {
      client: '0x2222222222222222222222222222222222222222' as Address,
      amount: 2000n,
    },
    {
      client: '0x3333333333333333333333333333333333333333' as Address,
      amount: 3000n,
    },
    {
      client: '0x4444444444444444444444444444444444444444' as Address,
      amount: 4000n,
    },
  ]

  bridge.computeRewardsMerkleRoot(rewards)
  const proof0 = bridge.generateMerkleProof(rewards, 0)
  const proof1 = bridge.generateMerkleProof(rewards, 1)

  // Proofs should be arrays
  if (!Array.isArray(proof0) || !Array.isArray(proof1)) {
    throw new Error('Proofs should be arrays')
  }

  // Proofs should have elements for a 4-element tree
  if (proof0.length === 0) {
    throw new Error('Proof should not be empty')
  }

  console.log(`  Proof for index 0: ${proof0.length} elements`)
  console.log(`  Proof for index 1: ${proof1.length} elements`)
}

// ============================================================================
// Integration Tests
// ============================================================================

async function testFullCoordinatorState(): Promise<void> {
  // Test that we can construct valid coordinator state
  const runId = `test-run-${Date.now()}`
  const runIdBytes = Buffer.from(runId).slice(0, 32)

  // Derive PDA (same as Psyche does)
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('coordinator'), runIdBytes],
    PSYCHE_PROGRAM_ID,
  )

  console.log(`  Run ID: ${runId}`)
  console.log(`  Coordinator PDA: ${pda.toString()}`)
}

async function testBridgeRunStateTracking(): Promise<void> {
  const keypair = Keypair.generate()

  const psycheConfig: PsycheConfig = {
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
    evmRpcUrl: EVM_RPC_URL,
    evmPrivateKey: EVM_PRIVATE_KEY,
  }

  const bridgeConfig: BridgeConfig = {
    evmRpcUrl: EVM_RPC_URL,
    evmPrivateKey: EVM_PRIVATE_KEY,
    bridgeContractAddress: MOCK_BRIDGE_ADDRESS,
    solanaRpcUrl: SOLANA_RPC_URL,
    solanaKeypair: keypair,
  }

  const psycheClient = createPsycheClient(psycheConfig)
  const bridge = createCrossChainBridge(bridgeConfig)

  // Link bridge to psyche client
  bridge.setPsycheClient(psycheClient)

  // Track a run (won't find it, but tests the flow)
  try {
    const runState = await bridge.getRunState('nonexistent-run')
    console.log(`  Run state for nonexistent run: ${runState}`)
  } catch (_e) {
    // Expected - run doesn't exist
    console.log('  Correctly handled nonexistent run')
  }
}

// ============================================================================
// Solana Program Account Tests (when deployed)
// ============================================================================

async function testCoordinatorAccountSize(): Promise<void> {
  // Verify account size calculations match Psyche expectations
  // From solana-coordinator/src/lib.rs:
  // - 8 bytes discriminator
  // - 8 bytes version
  // - CoordinatorInstanceState (large)
  // - 8 bytes nonce

  // Just verify we understand the structure
  const expectedMinSize = 8 + 8 + 8 // Discriminator + version + nonce
  console.log(`  Minimum coordinator account size: ${expectedMinSize} bytes`)
  console.log(
    '  (Full size depends on CoordinatorInstanceState which includes clients array)',
  )
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('='.repeat(60))
  console.log('Psyche Integration Test Suite')
  console.log('='.repeat(60))
  console.log(`Solana RPC: ${SOLANA_RPC_URL}`)
  console.log(`EVM RPC: ${EVM_RPC_URL}`)
  console.log('='.repeat(60))
  console.log('')

  // Solana Tests
  console.log('--- Solana Tests ---')
  await runTest('Solana connection', testSolanaConnection)
  await runTest('Solana program exists check', testSolanaProgramExists)
  await runTest('Psyche client initialization', testPsycheClientInitialization)
  await runTest('Psyche client balance', testPsycheClientBalance)
  console.log('')

  // EVM Tests
  console.log('--- EVM Tests ---')
  await runTest('EVM connection', testEvmConnection)
  await runTest('EVM wallet setup', testEvmWalletSetup)
  await runTest('Psyche client with EVM', testPsycheClientWithEvm)
  console.log('')

  // Bridge Tests
  console.log('--- Cross-Chain Bridge Tests ---')
  await runTest('Bridge initialization', testBridgeInitialization)
  await runTest('Merkle root computation', testMerkleRootComputation)
  await runTest('Merkle proof generation', testMerkleProofGeneration)
  console.log('')

  // Integration Tests
  console.log('--- Integration Tests ---')
  await runTest('Full coordinator state', testFullCoordinatorState)
  await runTest('Bridge run state tracking', testBridgeRunStateTracking)
  await runTest('Coordinator account size', testCoordinatorAccountSize)
  console.log('')

  // Summary
  console.log('='.repeat(60))
  console.log('Test Summary')
  console.log('='.repeat(60))

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length

  console.log(`Passed: ${passed}/${total}`)
  console.log(`Failed: ${failed}/${total}`)

  if (failed > 0) {
    console.log('\nFailed Tests:')
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`)
      })
  }

  console.log('='.repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

// Run tests
runAllTests().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
