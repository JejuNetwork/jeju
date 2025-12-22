/**
 * Integration Tests for Cross-Chain Bridge
 *
 * Tests the SDK functionality:
 * - Client creation and configuration
 * - TEE batching
 * - Chain connectivity (when available)
 * - Type validation
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test'
import { Keypair, PublicKey } from '@solana/web3.js'
import { type Subprocess, spawn } from 'bun'
import type { Hex } from 'viem'
import {
  ChainId,
  type CrossChainTransfer,
  createEVMClient,
  createSolanaClient,
  createTEEBatcher,
  LOCAL_TEE_CONFIG,
  toHash32,
} from '../../src/index.js'

// Set test timeout for all tests in this file
setDefaultTimeout(60000)

// Test configuration
const TEST_CONFIG = {
  evmRpc: 'http://127.0.0.1:8545',
  solanaRpc: 'http://127.0.0.1:8899',
}

// Test accounts
const EVM_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex
const SOLANA_KEYPAIR = Keypair.generate()

// Mock addresses for client creation tests
const MOCK_ADDRESSES = {
  groth16Verifier: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Hex,
  solanaLightClient: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Hex,
  crossChainBridge: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Hex,
  testToken: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as Hex,
}

// Chain availability flags
let evmAvailable = false
let solanaAvailable = false

// Process handles for cleanup
let anvilProcess: Subprocess | null = null
let solanaProcess: Subprocess | null = null

describe('Cross-Chain Bridge Integration', () => {
  beforeAll(async () => {
    // Check if chains are already running
    evmAvailable = await isEVMRunning()
    solanaAvailable = await isSolanaRunning()

    if (!evmAvailable) {
      console.log('Starting Anvil...')
      anvilProcess = spawn({
        cmd: ['anvil', '--port', '8545', '--chain-id', '31337'],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      evmAvailable = await waitForEVM()
    }

    if (!solanaAvailable) {
      console.log('Starting Solana validator...')
      solanaProcess = spawn({
        cmd: ['solana-test-validator', '--reset', '--quiet'],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      solanaAvailable = await waitForSolana()
    }

    console.log(
      `Chain availability: EVM=${evmAvailable}, Solana=${solanaAvailable}`,
    )
  })

  afterAll(async () => {
    if (anvilProcess) {
      anvilProcess.kill()
    }
    if (solanaProcess) {
      solanaProcess.kill()
    }
  })

  describe('EVM Client Creation', () => {
    it('should create EVM client with valid config', () => {
      const evmClient = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: TEST_CONFIG.evmRpc,
        privateKey: EVM_PRIVATE_KEY,
        bridgeAddress: MOCK_ADDRESSES.crossChainBridge,
        lightClientAddress: MOCK_ADDRESSES.solanaLightClient,
      })

      expect(evmClient).toBeDefined()
      expect(evmClient.getChainId()).toBe(ChainId.LOCAL_EVM)
      expect(evmClient.getAddress()).toBeDefined()
    })

    it('should create EVM client without private key (read-only)', () => {
      const evmClient = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: TEST_CONFIG.evmRpc,
        bridgeAddress: MOCK_ADDRESSES.crossChainBridge,
        lightClientAddress: MOCK_ADDRESSES.solanaLightClient,
      })

      expect(evmClient).toBeDefined()
      expect(evmClient.getAddress()).toBeNull()
    })
  })

  describe('Solana Client Creation', () => {
    it('should create Solana client with valid config', () => {
      const solanaClient = createSolanaClient({
        rpcUrl: TEST_CONFIG.solanaRpc,
        commitment: 'confirmed',
        keypair: SOLANA_KEYPAIR,
        bridgeProgramId: new PublicKey('11111111111111111111111111111111'),
        evmLightClientProgramId: new PublicKey(
          '11111111111111111111111111111112',
        ),
      })

      expect(solanaClient).toBeDefined()
      expect(solanaClient.getPublicKey()).toBeDefined()
    })

    it('should connect to Solana when available', async () => {
      if (!solanaAvailable) {
        console.log('Skipping: Solana not available')
        return
      }

      const solanaClient = createSolanaClient({
        rpcUrl: TEST_CONFIG.solanaRpc,
        commitment: 'confirmed',
        keypair: SOLANA_KEYPAIR,
        bridgeProgramId: new PublicKey('11111111111111111111111111111111'),
        evmLightClientProgramId: new PublicKey(
          '11111111111111111111111111111112',
        ),
      })

      const slot = await solanaClient.getLatestSlot()
      expect(slot).toBeGreaterThanOrEqual(BigInt(0))
    })

    it('should get latest blockhash when available', async () => {
      if (!solanaAvailable) {
        console.log('Skipping: Solana not available')
        return
      }

      const solanaClient = createSolanaClient({
        rpcUrl: TEST_CONFIG.solanaRpc,
        commitment: 'confirmed',
        keypair: SOLANA_KEYPAIR,
        bridgeProgramId: new PublicKey('11111111111111111111111111111111'),
        evmLightClientProgramId: new PublicKey(
          '11111111111111111111111111111112',
        ),
      })

      const blockhash = await solanaClient.getLatestBlockhash()
      expect(blockhash).toBeDefined()
      expect(blockhash.length).toBeGreaterThan(0)
    })
  })

  describe('TEE Batching', () => {
    it('should initialize TEE batcher', async () => {
      const batcher = createTEEBatcher(LOCAL_TEE_CONFIG)
      await batcher.initialize()

      const attestation = batcher.getAttestation()
      expect(attestation).not.toBeNull()
      expect(attestation?.measurement.length).toBe(32)
    })

    it('should batch transfers', async () => {
      const batcher = createTEEBatcher({
        ...LOCAL_TEE_CONFIG,
        minBatchSize: 1,
        maxBatchSize: 5,
      })
      await batcher.initialize()

      const transfer = createMockTransfer(1)
      const result = await batcher.addTransfer(transfer)

      expect(result.batchId).toBeDefined()
      expect(result.position).toBe(0)
      expect(result.estimatedCost).toBeGreaterThan(BigInt(0))
    })

    it('should batch multiple transfers efficiently', async () => {
      const batcher = createTEEBatcher({
        ...LOCAL_TEE_CONFIG,
        minBatchSize: 1,
        maxBatchSize: 10,
      })
      await batcher.initialize()

      const results = []
      for (let i = 0; i < 5; i++) {
        results.push(await batcher.addTransfer(createMockTransfer(i)))
      }

      // All should be in same batch
      const batchIds = new Set(results.map((r) => r.batchId))
      expect(batchIds.size).toBe(1)

      // Positions should be sequential
      const positions = results.map((r) => r.position).sort((a, b) => a - b)
      expect(positions).toEqual([0, 1, 2, 3, 4])
    })
  })

  describe('Transfer Types', () => {
    it('should create valid cross-chain transfer', () => {
      const transfer = createMockTransfer(100)

      expect(transfer.transferId.length).toBe(32)
      expect(transfer.sender.length).toBe(32)
      expect(transfer.recipient.length).toBe(32)
      expect(transfer.token.length).toBe(32)
      expect(transfer.amount).toBeGreaterThan(BigInt(0))
    })

    it('should generate unique transfer IDs', () => {
      const t1 = createMockTransfer(1)
      const t2 = createMockTransfer(2)

      // Different nonces should produce different IDs
      expect(t1.transferId).not.toEqual(t2.transferId)
    })
  })
})

// Helper functions
function createMockTransfer(nonce: number): CrossChainTransfer {
  return {
    transferId: toHash32(new Uint8Array(32).map((_, i) => (nonce + i) % 256)),
    sourceChain: ChainId.LOCAL_EVM,
    destChain: ChainId.LOCAL_SOLANA,
    token: toHash32(new Uint8Array(32).fill(0x01)),
    sender: new Uint8Array(32).fill(0x02),
    recipient: new Uint8Array(32).fill(0x03),
    amount: BigInt(1000000 * (nonce + 1)),
    nonce: BigInt(nonce),
    timestamp: BigInt(Date.now()),
    payload: new Uint8Array(0),
  }
}

async function isEVMRunning(): Promise<boolean> {
  try {
    const response = await fetch(TEST_CONFIG.evmRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

async function isSolanaRunning(): Promise<boolean> {
  try {
    const response = await fetch(TEST_CONFIG.solanaRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getHealth',
        id: 1,
      }),
    })
    if (!response.ok) return false
    const data = (await response.json()) as { result?: string }
    return data.result === 'ok'
  } catch {
    return false
  }
}

async function waitForEVM(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isEVMRunning()) return true
    await Bun.sleep(1000)
  }
  console.warn('EVM chain failed to start within timeout')
  return false
}

async function waitForSolana(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isSolanaRunning()) return true
    await Bun.sleep(1000)
  }
  console.warn('Solana validator failed to start within timeout')
  return false
}
