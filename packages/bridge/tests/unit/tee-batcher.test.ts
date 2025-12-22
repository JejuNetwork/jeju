/**
 * Unit Tests for TEE Batcher
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { createTEEBatcher, type TEEBatcher } from '../../src/tee/batcher.js'
import {
  ChainId,
  type CrossChainTransfer,
  type TEEBatchingConfig,
  toHash32,
} from '../../src/types/index.js'

describe('TEE Batcher', () => {
  let batcher: TEEBatcher
  const config: TEEBatchingConfig = {
    maxBatchSize: 10,
    maxBatchWaitMs: 5000,
    minBatchSize: 1,
    targetCostPerItem: BigInt(1000000000000000), // 0.001 ETH
    teeEndpoint: 'http://localhost:8080',
  }

  beforeEach(async () => {
    batcher = createTEEBatcher(config)
    await batcher.initialize()
  })

  describe('initialization', () => {
    it('should initialize with valid attestation', async () => {
      const attestation = batcher.getAttestation()
      expect(attestation).not.toBeNull()
      expect(attestation?.measurement.length).toBe(32)
    })

    it('should have correct config', () => {
      expect(batcher.config.maxBatchSize).toBe(10)
      expect(batcher.config.minBatchSize).toBe(1)
    })
  })

  describe('addTransfer', () => {
    it('should add transfer to batch', async () => {
      const transfer = createMockTransfer(1)
      const result = await batcher.addTransfer(transfer)

      expect(result.batchId).toBeDefined()
      expect(result.position).toBe(0)
      expect(result.estimatedCost).toBeGreaterThan(BigInt(0))
    })

    it('should increment position for multiple transfers', async () => {
      const t1 = createMockTransfer(1)
      const t2 = createMockTransfer(2)
      const t3 = createMockTransfer(3)

      const r1 = await batcher.addTransfer(t1)
      const r2 = await batcher.addTransfer(t2)
      const r3 = await batcher.addTransfer(t3)

      expect(r1.position).toBe(0)
      expect(r2.position).toBe(1)
      expect(r3.position).toBe(2)
    })

    it('should share same batchId until batch is finalized', async () => {
      const t1 = createMockTransfer(1)
      const t2 = createMockTransfer(2)

      const r1 = await batcher.addTransfer(t1)
      const r2 = await batcher.addTransfer(t2)

      expect(r1.batchId).toBe(r2.batchId)
    })

    it('should estimate cost correctly', async () => {
      const transfer = createMockTransfer(1)
      const result = await batcher.addTransfer(transfer)

      // Base cost should be > 0
      expect(result.estimatedCost).toBeGreaterThan(BigInt(0))
      // Cost should be less than target per item (amortized)
      expect(result.estimatedCost).toBeLessThanOrEqual(config.targetCostPerItem)
    })
  })

  describe('batch management', () => {
    it('should return null when no batches ready', () => {
      const nextBatch = batcher.getNextBatchForProving()
      expect(nextBatch).toBeNull()
    })

    it('should track batch status correctly', async () => {
      const transfer = createMockTransfer(1)
      const result = await batcher.addTransfer(transfer)

      // batchId is now a hex string, use it directly
      const status = batcher.getBatchStatus(result.batchId)

      expect(status).not.toBeNull()
      expect(status?.status).toBe('accumulating')
    })

    it('should return null for non-existent batch', () => {
      const status = batcher.getBatchStatus('nonexistent')
      expect(status).toBeNull()
    })
  })

  describe('validation', () => {
    it('should reject transfer with zero amount', async () => {
      const transfer = createMockTransfer(1)
      transfer.amount = BigInt(0)

      expect(batcher.addTransfer(transfer)).rejects.toThrow(
        'Transfer amount must be positive',
      )
    })

    it('should reject transfer with empty sender', async () => {
      const transfer = createMockTransfer(1)
      transfer.sender = new Uint8Array(0)

      expect(batcher.addTransfer(transfer)).rejects.toThrow(
        'Sender address required',
      )
    })

    it('should reject transfer with empty recipient', async () => {
      const transfer = createMockTransfer(1)
      transfer.recipient = new Uint8Array(0)

      expect(batcher.addTransfer(transfer)).rejects.toThrow(
        'Recipient address required',
      )
    })

    it('should reject transfer with negative amount', async () => {
      const transfer = createMockTransfer(1)
      transfer.amount = BigInt(-100)

      expect(batcher.addTransfer(transfer)).rejects.toThrow(
        'Transfer amount must be positive',
      )
    })
  })

  describe('cost estimation', () => {
    it('should increase cost for transfers with payload', async () => {
      const t1 = createMockTransfer(1)
      t1.payload = new Uint8Array(0)

      const t2 = createMockTransfer(2)
      t2.payload = new Uint8Array(100).fill(0xab)

      // Create fresh batchers to isolate tests
      const b1 = createTEEBatcher(config)
      await b1.initialize()
      const b2 = createTEEBatcher(config)
      await b2.initialize()

      const r1 = await b1.addTransfer(t1)
      const r2 = await b2.addTransfer(t2)

      expect(r2.estimatedCost).toBeGreaterThan(r1.estimatedCost)
    })
  })

  describe('attestation', () => {
    it('should have valid attestation structure', async () => {
      const attestation = batcher.getAttestation()
      expect(attestation).not.toBeNull()
      expect(attestation?.measurement.length).toBe(32)
      expect(attestation?.quote.length).toBeGreaterThan(0)
      expect(attestation?.publicKey.length).toBe(33)
      expect(attestation?.timestamp).toBeGreaterThan(BigInt(0))
    })
  })
})

function createMockTransfer(nonce: number): CrossChainTransfer {
  return {
    transferId: toHash32(new Uint8Array(32).map((_, i) => (nonce + i) % 256)),
    sourceChain: ChainId.LOCAL_EVM,
    destChain: ChainId.LOCAL_SOLANA,
    token: toHash32(new Uint8Array(32).fill(0x01)),
    sender: new Uint8Array(32).fill(0x02),
    recipient: new Uint8Array(32).fill(0x03),
    amount: BigInt(1000000 * nonce),
    nonce: BigInt(nonce),
    timestamp: BigInt(Date.now()),
    payload: new Uint8Array(0),
  }
}
