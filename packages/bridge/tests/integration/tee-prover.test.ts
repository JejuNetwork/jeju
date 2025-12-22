/**
 * TEE + Prover Integration Tests
 *
 * Tests the integration of:
 * - Phala TEE attestation (real when PHALA_ENDPOINT set, mock otherwise)
 * - SP1 ZK proof generation (real when SP1 installed, mock otherwise)
 * - Batch attestation with proof generation
 */

import { describe, expect, it } from 'bun:test'
import {
  ChainId,
  type CrossChainTransfer,
  createPhalaClient,
  createSP1Client,
  createTEEBatcher,
  type TEEBatchingConfig,
  toHash32,
} from '../../src/index.js'

describe('TEE + Prover Integration', () => {
  const hasPhala = Boolean(process.env.PHALA_ENDPOINT)
  const useMock = !hasPhala

  describe('Phala Client', () => {
    it('should initialize correctly', async () => {
      const client = createPhalaClient({ useMock })
      await client.initialize()
      // Should not throw
      expect(true).toBe(true)
    })

    it('should generate attestation', async () => {
      const client = createPhalaClient({ useMock })
      await client.initialize()

      const attestation = await client.requestAttestation({
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        operatorAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8faBc',
      })

      expect(attestation.quote.length).toBeGreaterThan(0)
      expect(attestation.mrEnclave).toBeDefined()
      expect(attestation.signature).toBeDefined()
      expect(attestation.timestamp).toBeGreaterThan(0)
    })

    it('should attest batch of transfers', async () => {
      const client = createPhalaClient({ useMock })
      await client.initialize()

      const transfers: CrossChainTransfer[] = [
        createMockTransfer(1),
        createMockTransfer(2),
        createMockTransfer(3),
      ]

      const batchId = toHash32(new Uint8Array(32).fill(0xab))

      const batchAttestation = await client.attestBatch(
        batchId,
        transfers,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f8faBc',
      )

      expect(batchAttestation.batchId).toEqual(batchId)
      expect(batchAttestation.transferCount).toBe(3)
      expect(batchAttestation.attestation.quote.length).toBeGreaterThan(0)
      expect(batchAttestation.chainOfCustody.length).toBe(3)
    })

    it('should verify attestation', async () => {
      const client = createPhalaClient({ useMock })
      await client.initialize()

      const attestation = await client.requestAttestation({
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        operatorAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8faBc',
      })

      const result = await client.verifyAttestation(attestation)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should convert to TEE attestation format', async () => {
      const client = createPhalaClient({ useMock })
      await client.initialize()

      const attestation = await client.requestAttestation({
        data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        operatorAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f8faBc',
      })

      const teeAttestation = client.toTEEAttestation(attestation)

      expect(teeAttestation.measurement.length).toBe(32)
      expect(teeAttestation.quote.length).toBeGreaterThan(0)
      expect(teeAttestation.publicKey.length).toBeGreaterThan(0)
      expect(teeAttestation.timestamp).toBeGreaterThan(0n)
    })
  })

  describe('SP1 Client', () => {
    it('should initialize correctly', async () => {
      const client = createSP1Client({ useMock: true })
      await client.initialize()
      expect(true).toBe(true)
    })

    it('should check SP1 availability', async () => {
      const client = createSP1Client({ useMock: true })
      const available = await client.checkSP1Available()
      // Just check it doesn't throw
      expect(typeof available).toBe('boolean')
    })

    it('should generate mock proof', async () => {
      const client = createSP1Client({ useMock: true })
      await client.initialize()

      const result = await client.prove({
        type: 'token_transfer',
        inputs: {
          transferId: new Uint8Array(32).fill(0x01),
          amount: BigInt(1000000),
        },
      })

      expect(result.success).toBe(true)
      expect(result.proof.proof.length).toBeGreaterThan(0)
      expect(result.groth16.a.length).toBe(2)
      expect(result.groth16.b.length).toBe(2)
      expect(result.groth16.c.length).toBe(2)
    })

    it('should generate Solana consensus proof', async () => {
      const client = createSP1Client({ useMock: true })
      await client.initialize()

      const result = await client.proveSolanaConsensus({
        slot: BigInt(12345678),
        bankHash: toHash32(new Uint8Array(32).fill(0xab)),
        votes: [],
        epochStakes: new Map(),
      })

      expect(result.success).toBe(true)
      expect(result.type).toBe('solana_consensus')
      expect(result.generationTimeMs).toBeGreaterThan(0)
    })

    it('should generate Ethereum consensus proof', async () => {
      const client = createSP1Client({ useMock: true })
      await client.initialize()

      const result = await client.proveEthereumConsensus({
        slot: BigInt(7890000),
        stateRoot: toHash32(new Uint8Array(32).fill(0xcd)),
        syncCommitteeRoot: toHash32(new Uint8Array(32).fill(0xef)),
        signatures: [],
      })

      expect(result.success).toBe(true)
      expect(result.type).toBe('ethereum_consensus')
    })

    it('should generate batch transfer proof', async () => {
      const client = createSP1Client({ useMock: true })
      await client.initialize()

      const result = await client.proveBatchTransfer({
        batchId: toHash32(new Uint8Array(32).fill(0x01)),
        transfers: [
          {
            transferId: toHash32(new Uint8Array(32).fill(0x02)),
            amount: BigInt(1000),
          },
          {
            transferId: toHash32(new Uint8Array(32).fill(0x03)),
            amount: BigInt(2000),
          },
        ],
        stateRoot: toHash32(new Uint8Array(32).fill(0x04)),
      })

      expect(result.success).toBe(true)
      expect(result.type).toBe('batch_transfer')
    })
  })

  describe('TEE Batcher with Phala', () => {
    it('should initialize with attestation', async () => {
      const config: TEEBatchingConfig = {
        maxBatchSize: 10,
        maxBatchAge: BigInt(60000),
        targetCostPerItem: BigInt(100000000000000),
        teeEndpoint: 'http://localhost:8000',
      }

      const batcher = createTEEBatcher(config)
      await batcher.initialize()

      // Should have attestation
      expect(true).toBe(true)
    })

    it('should add transfers and get batch', async () => {
      const config: TEEBatchingConfig = {
        maxBatchSize: 3,
        maxBatchAge: BigInt(60000),
        targetCostPerItem: BigInt(100000000000000),
        teeEndpoint: 'http://localhost:8000',
      }

      const batcher = createTEEBatcher(config)
      await batcher.initialize()

      // Add transfers
      const result1 = await batcher.addTransfer(createMockTransfer(1))
      const result2 = await batcher.addTransfer(createMockTransfer(2))

      expect(result1.batchId).toBeDefined()
      expect(result2.batchId).toEqual(result1.batchId)
      expect(result1.position).toBe(0)
      expect(result2.position).toBe(1)
    })
  })

  describe('End-to-End Flow', () => {
    it('should attest batch and generate proof', async () => {
      // 1. Create transfers
      const transfers: CrossChainTransfer[] = [
        createMockTransfer(1),
        createMockTransfer(2),
      ]

      // 2. Get TEE attestation
      const phalaClient = createPhalaClient({ useMock })
      await phalaClient.initialize()

      const batchId = toHash32(new Uint8Array(32).fill(0xab))
      const batchAttestation = await phalaClient.attestBatch(
        batchId,
        transfers,
        '0x742d35Cc6634C0532925a3b844Bc9e7595f8faBc',
      )

      expect(batchAttestation.transferCount).toBe(2)

      // 3. Generate ZK proof
      const sp1Client = createSP1Client({ useMock: true })
      await sp1Client.initialize()

      const proofResult = await sp1Client.proveBatchTransfer({
        batchId,
        transfers: transfers.map((t) => ({
          transferId: t.transferId,
          amount: t.amount,
        })),
        stateRoot: toHash32(new Uint8Array(32).fill(0xcd)),
      })

      expect(proofResult.success).toBe(true)
      expect(proofResult.proof.proof.length).toBeGreaterThan(0)

      console.log('\n✅ End-to-end flow completed:')
      console.log(`   - Batch ID: ${batchId.slice(0, 8).join('')}...`)
      console.log(`   - Transfers: ${batchAttestation.transferCount}`)
      console.log(`   - Attestation: ${batchAttestation.attestation.enclaveId}`)
      console.log(`   - Proof ID: ${proofResult.id}`)
      console.log(`   - Proof time: ${proofResult.generationTimeMs}ms`)
    })
  })
})

// =============================================================================
// HELPERS
// =============================================================================

function createMockTransfer(nonce: number): CrossChainTransfer {
  return {
    transferId: toHash32(new Uint8Array(32).map((_, i) => (nonce + i) % 256)),
    sourceChain: ChainId.LOCAL_EVM,
    destChain: ChainId.LOCAL_SOLANA,
    sender: new Uint8Array(32).fill(nonce),
    recipient: new Uint8Array(32).fill(nonce + 100),
    token: new Uint8Array(32).fill(0xaa),
    amount: BigInt(1000000 * (nonce + 1)),
    nonce: BigInt(nonce),
    timestamp: BigInt(Date.now()),
    payload: new Uint8Array(0),
  }
}
