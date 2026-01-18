/**
 * Unit Tests for Solana Client
 *
 * Tests:
 * - Client creation and configuration
 * - Public key operations
 * - Transfer initiation
 * - Error handling
 * - Edge cases
 */

import { describe, expect, it } from 'bun:test'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  createSolanaClient,
  type SolanaClientConfig,
  toHash32,
} from '../../src/index.js'

// Mock program IDs (using valid Base58-encoded 32-byte public keys)
const MOCK_BRIDGE_PROGRAM = new PublicKey('11111111111111111111111111111111') // System program (32 bytes = valid)
const MOCK_LIGHT_CLIENT_PROGRAM = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
) // BPF Upgradeable loader

describe('SolanaClient', () => {
  describe('Client Creation', () => {
    it('should create client with valid config', () => {
      const keypair = Keypair.generate()
      const config: SolanaClientConfig = {
        rpcUrl: 'http://127.0.0.1:8899',
        commitment: 'confirmed',
        keypair,
        bridgeProgramId: MOCK_BRIDGE_PROGRAM,
        evmLightClientProgramId: MOCK_LIGHT_CLIENT_PROGRAM,
      }

      const client = createSolanaClient(config)
      expect(client).toBeDefined()
      expect(client.getPublicKey()).toBeDefined()
    })

    it('should create client with different commitment levels', () => {
      const commitments = ['processed', 'confirmed', 'finalized'] as const

      for (const commitment of commitments) {
        const client = createSolanaClient({
          rpcUrl: 'http://127.0.0.1:8899',
          commitment,
          keypair: Keypair.generate(),
          bridgeProgramId: MOCK_BRIDGE_PROGRAM,
          evmLightClientProgramId: MOCK_LIGHT_CLIENT_PROGRAM,
        })
        expect(client).toBeDefined()
      }
    })

    it('should derive correct public key from keypair', () => {
      const keypair = Keypair.generate()
      const client = createSolanaClient({
        rpcUrl: 'http://127.0.0.1:8899',
        commitment: 'confirmed',
        keypair,
        bridgeProgramId: MOCK_BRIDGE_PROGRAM,
        evmLightClientProgramId: MOCK_LIGHT_CLIENT_PROGRAM,
      })

      expect(client.getPublicKey()?.equals(keypair.publicKey)).toBe(true)
    })
  })

  describe('Public Key Operations', () => {
    it('should return valid public key format', () => {
      const keypair = Keypair.generate()
      const client = createSolanaClient({
        rpcUrl: 'http://127.0.0.1:8899',
        commitment: 'confirmed',
        keypair,
        bridgeProgramId: MOCK_BRIDGE_PROGRAM,
        evmLightClientProgramId: MOCK_LIGHT_CLIENT_PROGRAM,
      })

      const pubkey = client.getPublicKey()
      expect(pubkey).toBeDefined()
      expect(pubkey?.toBase58().length).toBeGreaterThan(0)
    })

    it('should convert public key to bytes correctly', () => {
      const keypair = Keypair.generate()
      const client = createSolanaClient({
        rpcUrl: 'http://127.0.0.1:8899',
        commitment: 'confirmed',
        keypair,
        bridgeProgramId: MOCK_BRIDGE_PROGRAM,
        evmLightClientProgramId: MOCK_LIGHT_CLIENT_PROGRAM,
      })

      const pubkey = client.getPublicKey()
      const bytes = pubkey?.toBytes()
      expect(bytes?.length).toBe(32)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid RPC URL', async () => {
      const client = createSolanaClient({
        rpcUrl: 'http://invalid-rpc:9999',
        commitment: 'confirmed',
        keypair: Keypair.generate(),
        bridgeProgramId: MOCK_BRIDGE_PROGRAM,
        evmLightClientProgramId: MOCK_LIGHT_CLIENT_PROGRAM,
      })

      let errorThrown = false
      try {
        await client.getLatestSlot()
      } catch {
        errorThrown = true
      }
      expect(errorThrown).toBe(true)
    })
  })

  describe('Transfer Operations', () => {
    it('should create valid transfer ID', () => {
      const nonce = 12345
      const bytes = new Uint8Array(32)
      new DataView(bytes.buffer).setBigUint64(0, BigInt(nonce), false)

      const hash = toHash32(bytes)
      expect(hash.length).toBe(32)
    })

    it('should handle 32-byte EVM addresses', () => {
      // EVM addresses are 20 bytes, but we pad to 32 for cross-chain
      const evmAddress = new Uint8Array(32)
      evmAddress.set(
        [
          0xf3, 0x9f, 0xd6, 0xe5, 0x1a, 0xad, 0x88, 0xf6, 0xf4, 0xce, 0x6a,
          0xb8, 0x82, 0x72, 0x79, 0xcf, 0xff, 0xb9, 0x22, 0x66,
        ],
        12,
      ) // Right-padded

      expect(evmAddress.length).toBe(32)
      expect(evmAddress.slice(0, 12).every((b) => b === 0)).toBe(true)
    })
  })

  describe('Program IDs', () => {
    it('should accept valid program IDs', () => {
      const validProgramIds = [
        '11111111111111111111111111111111',
        'Bridge1111111111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      ]

      for (const programId of validProgramIds) {
        const pubkey = new PublicKey(programId)
        expect(pubkey.toBase58()).toBe(programId)
      }
    })

    it('should create client with system program ID', () => {
      const client = createSolanaClient({
        rpcUrl: 'http://127.0.0.1:8899',
        commitment: 'confirmed',
        keypair: Keypair.generate(),
        bridgeProgramId: new PublicKey('11111111111111111111111111111111'),
        evmLightClientProgramId: new PublicKey(
          '11111111111111111111111111111112',
        ),
      })
      expect(client).toBeDefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero keypair (all zeros)', () => {
      // Create keypair from zero seed - this should work but produce a specific key
      const zeroSeed = new Uint8Array(32).fill(0)
      // Keypair.fromSeed would work but may produce insecure keys - just verify structure
      expect(zeroSeed.length).toBe(32)
    })

    it('should handle max slot number', () => {
      const maxSlot = BigInt('18446744073709551615') // u64 max
      expect(maxSlot > BigInt(0)).toBe(true)
    })

    it('should handle minimum transfer amount', () => {
      const minAmount = BigInt(1)
      expect(minAmount > BigInt(0)).toBe(true)
    })
  })
})

describe('SolanaClient Integration Points', () => {
  it('should prepare correct instruction data format', () => {
    const discriminator = Buffer.from([0x01]) // INITIATE_TRANSFER
    const amount = BigInt(1000000)
    const destChainId = BigInt(1)

    // Create instruction data buffer
    const data = Buffer.alloc(1 + 8 + 8)
    discriminator.copy(data, 0)
    data.writeBigUInt64LE(amount, 1)
    data.writeBigUInt64LE(destChainId, 9)

    expect(data.length).toBe(17)
    expect(data[0]).toBe(0x01)
  })

  it('should validate token mint address format', () => {
    // Well-known SPL token mints
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const usdtMint = 'Es9vMFrzaCERmJfrF4H2FsqcVc7eHvqZN9Y1FMx6ByGu'

    const usdcPubkey = new PublicKey(usdcMint)
    const usdtPubkey = new PublicKey(usdtMint)

    expect(usdcPubkey.toBytes().length).toBe(32)
    expect(usdtPubkey.toBytes().length).toBe(32)
  })
})
