import { describe, expect, it } from 'bun:test'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import {
  createTokenBridgeClient,
  MAX_PAYLOAD_SIZE,
  TOKEN_BRIDGE_PROGRAM_ID,
  TokenBridgeClient,
} from '../bridge'

const connection = new Connection('https://api.devnet.solana.com')

describe('TokenBridgeClient', () => {
  describe('instantiation', () => {
    it('creates client with default program ID', () => {
      const client = createTokenBridgeClient(connection)
      expect(client).toBeInstanceOf(TokenBridgeClient)
    })

    it('creates client with custom program ID', () => {
      const customProgramId = Keypair.generate().publicKey
      const client = createTokenBridgeClient(connection, customProgramId)
      expect(client).toBeInstanceOf(TokenBridgeClient)
    })
  })

  describe('PDA derivation', () => {
    const client = createTokenBridgeClient(connection)

    it('derives bridge state PDA deterministically', () => {
      const [pda1, bump1] = client.getBridgeStatePDA()
      const [pda2, bump2] = client.getBridgeStatePDA()

      expect(pda1.equals(pda2)).toBe(true)
      expect(bump1).toBe(bump2)
      expect(bump1).toBeGreaterThanOrEqual(0)
      expect(bump1).toBeLessThanOrEqual(255)
    })

    it('derives different PDAs for different mints', () => {
      const mint1 = Keypair.generate().publicKey
      const mint2 = Keypair.generate().publicKey

      const [pda1] = client.getTokenConfigPDA(mint1)
      const [pda2] = client.getTokenConfigPDA(mint2)

      expect(pda1.equals(pda2)).toBe(false)
    })

    it('derives transfer PDA from nonce', () => {
      const [pda1] = client.getTransferPDA(1n)
      const [pda2] = client.getTransferPDA(2n)
      const [pda3] = client.getTransferPDA(1n)

      expect(pda1.equals(pda2)).toBe(false)
      expect(pda1.equals(pda3)).toBe(true)
    })

    it('derives completion PDA from transfer ID', () => {
      const transferId1 = new Uint8Array(32).fill(1)
      const transferId2 = new Uint8Array(32).fill(2)

      const [pda1] = client.getCompletionPDA(transferId1)
      const [pda2] = client.getCompletionPDA(transferId2)

      expect(pda1.equals(pda2)).toBe(false)
    })

    it('derives bridge vault PDA for mint', () => {
      const mint = Keypair.generate().publicKey
      const [vaultPDA, bump] = client.getBridgeVaultPDA(mint)

      expect(vaultPDA).toBeDefined()
      expect(bump).toBeGreaterThanOrEqual(0)
    })

    it('handles large nonce values', () => {
      const largeNonce = 2n ** 60n
      const [pda, bump] = client.getTransferPDA(largeNonce)

      expect(pda).toBeDefined()
      expect(bump).toBeGreaterThanOrEqual(0)
    })
  })

  describe('EVM address conversion', () => {
    const client = createTokenBridgeClient(connection)

    it('converts EVM address to bytes', () => {
      // Valid 40-char hex = 20 bytes
      const evmAddress = '0xdead00000000000000000000000000000000beef'
      const bytes = client.evmAddressToBytes(evmAddress)

      expect(bytes.length).toBe(20)
      expect(bytes[0]).toBe(0xde)
      expect(bytes[1]).toBe(0xad)
      expect(bytes[18]).toBe(0xbe)
      expect(bytes[19]).toBe(0xef)
    })

    it('converts bytes to EVM address', () => {
      const bytes = new Uint8Array(20)
      bytes[0] = 0xde
      bytes[1] = 0xad
      bytes[18] = 0xbe
      bytes[19] = 0xef

      const address = client.bytesToEvmAddress(bytes)
      expect(address).toBe('0xdead00000000000000000000000000000000beef')
    })

    it('roundtrips EVM address', () => {
      const original = '0x1234567890abcdef1234567890abcdef12345678'
      const bytes = client.evmAddressToBytes(original)
      const recovered = client.bytesToEvmAddress(bytes)
      expect(recovered).toBe(original)
    })

    it('handles checksummed addresses', () => {
      // Valid 40-char hex = 20 bytes, with mixed case
      const address = '0xDeaD00000000000000000000000000000000bEeF'
      const bytes = client.evmAddressToBytes(address)
      expect(bytes.length).toBe(20)
    })
  })

  describe('constants', () => {
    it('exports TOKEN_BRIDGE_PROGRAM_ID', () => {
      expect(TOKEN_BRIDGE_PROGRAM_ID).toBeDefined()
      expect(TOKEN_BRIDGE_PROGRAM_ID).toBeInstanceOf(PublicKey)
    })

    it('exports MAX_PAYLOAD_SIZE', () => {
      expect(MAX_PAYLOAD_SIZE).toBe(1024)
    })
  })
})

describe('Data serialization', () => {
  const client = createTokenBridgeClient(connection)

  describe('transfer nonce encoding', () => {
    it('encodes nonce in little-endian format in PDA', () => {
      // Different nonces should produce different PDAs
      const [pda1] = client.getTransferPDA(256n) // 0x0100
      const [pda2] = client.getTransferPDA(1n) // 0x0001

      expect(pda1.equals(pda2)).toBe(false)
    })

    it('handles zero nonce', () => {
      const [pda, bump] = client.getTransferPDA(0n)
      expect(pda).toBeDefined()
      expect(bump).toBeGreaterThanOrEqual(0)
    })

    it('handles max u64 nonce', () => {
      const maxU64 = 2n ** 64n - 1n
      const [pda, bump] = client.getTransferPDA(maxU64)
      expect(pda).toBeDefined()
      expect(bump).toBeGreaterThanOrEqual(0)
    })
  })
})
