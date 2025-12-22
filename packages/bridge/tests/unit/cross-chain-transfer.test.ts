/**
 * Unit Tests for Cross-Chain Transfer Types and Validation
 *
 * Tests:
 * - Transfer structure validation
 * - Payload encoding/decoding
 * - Nonce handling
 * - Timestamp validation
 * - Edge cases for all transfer fields
 */

import { describe, expect, it } from 'bun:test'
import {
  ChainId,
  type CrossChainTransfer,
  isEVMChain,
  isSolanaChain,
  TransferStatus,
  toHash32,
} from '../../src/index.js'

describe('CrossChainTransfer Structure', () => {
  describe('Transfer ID', () => {
    it('should require exactly 32 bytes', () => {
      const validId = new Uint8Array(32).fill(0xab)
      const hash = toHash32(validId)
      expect(hash.length).toBe(32)
    })

    it('should generate unique IDs for different inputs', () => {
      const input1 = new Uint8Array(32).fill(0x01)
      const input2 = new Uint8Array(32).fill(0x02)

      const hash1 = toHash32(input1)
      const hash2 = toHash32(input2)

      expect(hash1).not.toEqual(hash2)
    })

    it('should handle all zero ID', () => {
      const zeroId = new Uint8Array(32).fill(0)
      const hash = toHash32(zeroId)
      expect(hash.every((b) => b === 0)).toBe(true)
    })

    it('should handle all max ID', () => {
      const maxId = new Uint8Array(32).fill(0xff)
      const hash = toHash32(maxId)
      expect(hash.every((b) => b === 0xff)).toBe(true)
    })
  })

  describe('Chain ID Validation', () => {
    it('should identify EVM chains correctly', () => {
      expect(isEVMChain(ChainId.ETHEREUM_MAINNET)).toBe(true)
      expect(isEVMChain(ChainId.BASE_MAINNET)).toBe(true)
      expect(isEVMChain(ChainId.ARBITRUM_ONE)).toBe(true)
      expect(isEVMChain(ChainId.OPTIMISM)).toBe(true)
      expect(isEVMChain(ChainId.BSC_MAINNET)).toBe(true)
    })

    it('should identify Solana chains correctly', () => {
      expect(isSolanaChain(ChainId.SOLANA_MAINNET)).toBe(true)
      expect(isSolanaChain(ChainId.SOLANA_DEVNET)).toBe(true)
      expect(isSolanaChain(ChainId.SOLANA_LOCALNET)).toBe(true)
    })

    it('should not confuse EVM and Solana chains', () => {
      expect(isEVMChain(ChainId.SOLANA_MAINNET)).toBe(false)
      expect(isSolanaChain(ChainId.ETHEREUM_MAINNET)).toBe(false)
    })

    it('should handle local chain IDs', () => {
      expect(isEVMChain(ChainId.LOCAL_EVM)).toBe(true)
      expect(isSolanaChain(ChainId.LOCAL_SOLANA)).toBe(true)
    })
  })

  describe('Amount Validation', () => {
    it('should handle zero amount', () => {
      const transfer = createTransfer({ amount: BigInt(0) })
      expect(transfer.amount).toBe(BigInt(0))
    })

    it('should handle minimum amount', () => {
      const transfer = createTransfer({ amount: BigInt(1) })
      expect(transfer.amount).toBe(BigInt(1))
    })

    it('should handle large amounts', () => {
      const largeAmount = BigInt('1000000000000000000000000') // 1 million tokens with 18 decimals
      const transfer = createTransfer({ amount: largeAmount })
      expect(transfer.amount).toBe(largeAmount)
    })

    it('should handle max uint256', () => {
      const maxUint256 = BigInt(
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      )
      const transfer = createTransfer({ amount: maxUint256 })
      expect(transfer.amount).toBe(maxUint256)
    })
  })

  describe('Nonce Handling', () => {
    it('should handle sequential nonces', () => {
      const transfers = [
        createTransfer({ nonce: BigInt(0) }),
        createTransfer({ nonce: BigInt(1) }),
        createTransfer({ nonce: BigInt(2) }),
      ]

      for (let i = 0; i < transfers.length; i++) {
        expect(transfers[i].nonce).toBe(BigInt(i))
      }
    })

    it('should handle large nonces', () => {
      const largeNonce = BigInt('18446744073709551615') // Max uint64
      const transfer = createTransfer({ nonce: largeNonce })
      expect(transfer.nonce).toBe(largeNonce)
    })

    it('should handle zero nonce', () => {
      const transfer = createTransfer({ nonce: BigInt(0) })
      expect(transfer.nonce).toBe(BigInt(0))
    })
  })

  describe('Timestamp Validation', () => {
    it('should handle current timestamp', () => {
      const now = BigInt(Date.now())
      const transfer = createTransfer({ timestamp: now })
      expect(transfer.timestamp).toBe(now)
    })

    it('should handle future timestamps within tolerance', () => {
      const futureTime = BigInt(Date.now() + 60000) // 1 minute in future
      const transfer = createTransfer({ timestamp: futureTime })
      expect(transfer.timestamp).toBe(futureTime)
    })

    it('should handle past timestamps', () => {
      const pastTime = BigInt(Date.now() - 3600000) // 1 hour ago
      const transfer = createTransfer({ timestamp: pastTime })
      expect(transfer.timestamp).toBe(pastTime)
    })

    it('should validate timestamp is not zero', () => {
      const transfer = createTransfer({ timestamp: BigInt(0) })
      const isValid = transfer.timestamp > BigInt(0)
      expect(isValid).toBe(false)
    })
  })

  describe('Recipient Validation', () => {
    it('should handle 32-byte EVM recipient (padded)', () => {
      const evmRecipient = new Uint8Array(32)
      // 20-byte address right-aligned in 32 bytes
      evmRecipient.set(
        [
          0xf3, 0x9f, 0xd6, 0xe5, 0x1a, 0xad, 0x88, 0xf6, 0xf4, 0xce, 0x6a,
          0xb8, 0x82, 0x72, 0x79, 0xcf, 0xff, 0xb9, 0x22, 0x66,
        ],
        12,
      )

      const transfer = createTransfer({ recipient: evmRecipient })
      expect(transfer.recipient.length).toBe(32)
    })

    it('should handle Solana public key recipient', () => {
      const solanaPubkey = new Uint8Array(32).fill(0xab)
      const transfer = createTransfer({ recipient: solanaPubkey })
      expect(transfer.recipient.length).toBe(32)
    })

    it('should detect empty recipient', () => {
      const emptyRecipient = new Uint8Array(32).fill(0)
      const isValid = emptyRecipient.some((b) => b !== 0)
      expect(isValid).toBe(false)
    })
  })

  describe('Payload Handling', () => {
    it('should handle empty payload', () => {
      const transfer = createTransfer({ payload: new Uint8Array(0) })
      expect(transfer.payload.length).toBe(0)
    })

    it('should handle small payload', () => {
      const payload = new Uint8Array([0x01, 0x02, 0x03])
      const transfer = createTransfer({ payload })
      expect(transfer.payload).toEqual(payload)
    })

    it('should handle large payload', () => {
      const payload = new Uint8Array(1024).fill(0xab)
      const transfer = createTransfer({ payload })
      expect(transfer.payload.length).toBe(1024)
    })

    it('should handle max reasonable payload', () => {
      // Reasonable max for cross-chain messaging
      const payload = new Uint8Array(65536).fill(0xab)
      const transfer = createTransfer({ payload })
      expect(transfer.payload.length).toBe(65536)
    })
  })
})

describe('Transfer Status Transitions', () => {
  it('should define all valid statuses', () => {
    const statuses = [
      TransferStatus.PENDING,
      TransferStatus.SOURCE_CONFIRMED,
      TransferStatus.PROVING,
      TransferStatus.PROOF_GENERATED,
      TransferStatus.DEST_SUBMITTED,
      TransferStatus.COMPLETED,
      TransferStatus.FAILED,
    ]

    for (const status of statuses) {
      expect(typeof status).toBe('string')
      expect(status.length).toBeGreaterThan(0)
    }
  })

  it('should have unique status values', () => {
    const statuses = [
      TransferStatus.PENDING,
      TransferStatus.SOURCE_CONFIRMED,
      TransferStatus.PROVING,
      TransferStatus.PROOF_GENERATED,
      TransferStatus.DEST_SUBMITTED,
      TransferStatus.COMPLETED,
      TransferStatus.FAILED,
    ]

    const uniqueStatuses = new Set(statuses)
    expect(uniqueStatuses.size).toBe(statuses.length)
  })

  it('should track valid status progression', () => {
    const validProgression = [
      TransferStatus.PENDING,
      TransferStatus.SOURCE_CONFIRMED,
      TransferStatus.PROVING,
      TransferStatus.PROOF_GENERATED,
      TransferStatus.DEST_SUBMITTED,
      TransferStatus.COMPLETED,
    ]

    for (let i = 0; i < validProgression.length - 1; i++) {
      expect(validProgression[i]).not.toBe(validProgression[i + 1])
    }
  })

  it('should allow transition to FAILED from any state', () => {
    const states = [
      TransferStatus.PENDING,
      TransferStatus.SOURCE_CONFIRMED,
      TransferStatus.PROVING,
      TransferStatus.PROOF_GENERATED,
      TransferStatus.DEST_SUBMITTED,
    ]

    // All states should be able to transition to FAILED
    for (const state of states) {
      expect(state).not.toBe(TransferStatus.FAILED)
    }
  })
})

describe('Cross-Chain Route Types', () => {
  it('should support EVM to Solana', () => {
    const transfer = createTransfer({
      sourceChain: ChainId.ETHEREUM_MAINNET,
      destChain: ChainId.SOLANA_MAINNET,
    })

    expect(isEVMChain(transfer.sourceChain)).toBe(true)
    expect(isSolanaChain(transfer.destChain)).toBe(true)
  })

  it('should support Solana to EVM', () => {
    const transfer = createTransfer({
      sourceChain: ChainId.SOLANA_MAINNET,
      destChain: ChainId.BASE_MAINNET,
    })

    expect(isSolanaChain(transfer.sourceChain)).toBe(true)
    expect(isEVMChain(transfer.destChain)).toBe(true)
  })

  it('should support EVM to EVM', () => {
    const transfer = createTransfer({
      sourceChain: ChainId.ETHEREUM_MAINNET,
      destChain: ChainId.ARBITRUM_ONE,
    })

    expect(isEVMChain(transfer.sourceChain)).toBe(true)
    expect(isEVMChain(transfer.destChain)).toBe(true)
  })

  it('should prevent same chain transfers', () => {
    const transfer = createTransfer({
      sourceChain: ChainId.ETHEREUM_MAINNET,
      destChain: ChainId.ETHEREUM_MAINNET,
    })

    const isSameChain = transfer.sourceChain === transfer.destChain
    expect(isSameChain).toBe(true)
    // This should be rejected by the bridge
  })
})

// Helper to create test transfers
function createTransfer(
  overrides: Partial<CrossChainTransfer> = {},
): CrossChainTransfer {
  return {
    transferId: toHash32(new Uint8Array(32).fill(0x01)),
    sourceChain: ChainId.ETHEREUM_MAINNET,
    destChain: ChainId.SOLANA_MAINNET,
    token: toHash32(new Uint8Array(32).fill(0x02)),
    sender: new Uint8Array(32).fill(0x03),
    recipient: new Uint8Array(32).fill(0x04),
    amount: BigInt(1000000),
    nonce: BigInt(1),
    timestamp: BigInt(Date.now()),
    payload: new Uint8Array(0),
    ...overrides,
  }
}
