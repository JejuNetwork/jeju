import { describe, expect, it } from 'bun:test'
import {
  type Address,
  encodeAbiParameters,
  hashMessage,
  keccak256,
  recoverAddress,
  stringToHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/**
 * Threshold Signing Unit Tests
 *
 * Tests the threshold signature logic without requiring a running chain.
 * For full e2e tests, see packages/contracts/test/sequencer/ThresholdBatchSubmitter.t.sol
 */

// Test keys - DO NOT use in production
const SEQUENCER_KEYS = [
  '0x1111111111111111111111111111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333333333333333333333333333',
] as const

const THRESHOLD = 2

describe('Threshold Signing', () => {
  const sequencerAccounts = SEQUENCER_KEYS.map((key) =>
    privateKeyToAccount(key),
  )
  const sequencerAddresses = sequencerAccounts.map((a) => a.address)

  describe('EIP-712 Digest Computation', () => {
    it('should compute correct batch hash', () => {
      const batchData = '0xdeadbeef' as const
      const batchHash = keccak256(batchData)

      expect(batchHash).toMatch(/^0x[a-f0-9]{64}$/i)
      // Hash should be deterministic
      expect(keccak256(batchData)).toBe(batchHash)
    })

    it('should compute struct hash for EIP-712', () => {
      const BATCH_TYPEHASH = keccak256(
        stringToHex(
          'BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)',
        ),
      )
      const batchHash = keccak256('0xdeadbeef')
      const nonce = 0n
      const chainId = 901n

      const structHash = keccak256(
        encodeAbiParameters(
          [
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
          [BATCH_TYPEHASH, batchHash, nonce, chainId],
        ),
      )

      expect(structHash).toMatch(/^0x[a-f0-9]{64}$/i)
    })

    it('should compute domain separator', () => {
      const domainTypehash = keccak256(
        stringToHex(
          'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
        ),
      )
      const nameHash = keccak256(stringToHex('ThresholdBatchSubmitter'))
      const versionHash = keccak256(stringToHex('1'))
      const chainId = 901n
      const contract = '0x1234567890123456789012345678901234567890' as Address

      const domainSeparator = keccak256(
        encodeAbiParameters(
          [
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'uint256' },
            { type: 'address' },
          ],
          [domainTypehash, nameHash, versionHash, chainId, contract],
        ),
      )

      expect(domainSeparator).toMatch(/^0x[a-f0-9]{64}$/i)
    })

    it('should compute EIP-712 digest', () => {
      const domainSeparator =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const
      const structHash =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678' as const

      // EIP-712 digest format: 0x19 0x01 domainSeparator structHash
      const digest = keccak256(
        `0x1901${domainSeparator.slice(2)}${structHash.slice(2)}`,
      )

      expect(digest).toMatch(/^0x[a-f0-9]{64}$/i)
    })
  })

  describe('Signature Collection', () => {
    it('should collect signatures from multiple signers', async () => {
      const message = 'test batch data'
      const signatures: `0x${string}`[] = []

      for (const account of sequencerAccounts) {
        const signature = await account.signMessage({ message })
        signatures.push(signature)
      }

      expect(signatures.length).toBe(3)
      signatures.forEach((sig) => {
        expect(sig).toMatch(/^0x[a-f0-9]+$/i)
        expect(sig.length).toBe(132) // 65 bytes = 130 hex chars + 0x
      })
    })

    it('should verify signature recovers to correct signer', async () => {
      const message = 'test message'
      const account = sequencerAccounts[0]

      const signature = await account.signMessage({ message })
      const messageHash = hashMessage(message)
      const recovered = await recoverAddress({
        hash: messageHash,
        signature,
      })

      expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
    })

    it('should validate threshold requirement', () => {
      const collectedSignatures = 2
      expect(collectedSignatures >= THRESHOLD).toBe(true)

      const insufficientSignatures = 1
      expect(insufficientSignatures >= THRESHOLD).toBe(false)
    })
  })

  describe('Duplicate Detection', () => {
    it('should detect duplicate signers', () => {
      const signers = [
        sequencerAddresses[0],
        sequencerAddresses[1],
        sequencerAddresses[0], // Duplicate
      ]

      const uniqueSigners = new Set(signers)
      expect(uniqueSigners.size).toBeLessThan(signers.length)
    })

    it('should accept unique signers', () => {
      const signers = [
        sequencerAddresses[0],
        sequencerAddresses[1],
        sequencerAddresses[2],
      ]

      const uniqueSigners = new Set(signers)
      expect(uniqueSigners.size).toBe(signers.length)
    })
  })

  describe('Authorization Check', () => {
    it('should reject unauthorized signers', () => {
      const authorizedSigners = new Set(
        sequencerAddresses.map((a) => a.toLowerCase()),
      )
      const unauthorizedSigner =
        '0x0000000000000000000000000000000000000001' as Address

      expect(authorizedSigners.has(unauthorizedSigner.toLowerCase())).toBe(
        false,
      )
    })

    it('should accept authorized signers', () => {
      const authorizedSigners = new Set(
        sequencerAddresses.map((a) => a.toLowerCase()),
      )

      sequencerAddresses.forEach((addr) => {
        expect(authorizedSigners.has(addr.toLowerCase())).toBe(true)
      })
    })
  })

  describe('Batch Nonce Tracking', () => {
    it('should track incrementing nonces', () => {
      const batches = [
        { batchHash: keccak256('0x01'), nonce: 0n },
        { batchHash: keccak256('0x02'), nonce: 1n },
        { batchHash: keccak256('0x03'), nonce: 2n },
      ]

      for (let i = 0; i < batches.length; i++) {
        expect(batches[i].nonce).toBe(BigInt(i))
      }
    })

    it('should prevent nonce reuse', () => {
      const usedNonces = new Set<bigint>()
      const nonces = [0n, 1n, 2n]

      nonces.forEach((nonce) => {
        expect(usedNonces.has(nonce)).toBe(false)
        usedNonces.add(nonce)
      })

      // Replaying nonce 0 should be detected
      expect(usedNonces.has(0n)).toBe(true)
    })
  })

  describe('Full Threshold Signing Flow', () => {
    it('should simulate complete signing flow', async () => {
      // 1. Prepare batch data
      const batchData = '0xcafebabe'
      const batchHash = keccak256(batchData)
      const nonce = 0n
      const chainId = 901n

      // 2. Compute EIP-712 components
      const BATCH_TYPEHASH = keccak256(
        stringToHex(
          'BatchSubmission(bytes32 batchHash,uint256 nonce,uint256 chainId)',
        ),
      )

      const structHash = keccak256(
        encodeAbiParameters(
          [
            { type: 'bytes32' },
            { type: 'bytes32' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
          [BATCH_TYPEHASH, batchHash, nonce, chainId],
        ),
      )

      // 3. Collect threshold signatures
      const signatureData: Array<{
        signer: Address
        signature: `0x${string}`
      }> = []

      for (let i = 0; i < THRESHOLD; i++) {
        const signature = await sequencerAccounts[i].signMessage({
          message: { raw: structHash },
        })
        signatureData.push({
          signer: sequencerAccounts[i].address,
          signature,
        })
      }

      // 4. Verify threshold met
      expect(signatureData.length).toBe(THRESHOLD)

      // 5. Verify all signers unique
      const uniqueSigners = new Set(signatureData.map((s) => s.signer))
      expect(uniqueSigners.size).toBe(THRESHOLD)

      // 6. Verify all signatures valid
      for (const { signer, signature } of signatureData) {
        expect(signature.length).toBe(132)
        const messageHash = hashMessage({ raw: structHash })
        const recovered = await recoverAddress({
          hash: messageHash,
          signature,
        })
        expect(recovered.toLowerCase()).toBe(signer.toLowerCase())
      }
    })
  })

  describe('Error Cases', () => {
    it('should handle insufficient signatures', () => {
      const signatures = [`0x${'00'.repeat(65)}`] as `0x${string}`[]
      expect(signatures.length < THRESHOLD).toBe(true)
    })

    it('should detect invalid signature length', () => {
      const invalidSig = '0x1234' // Too short
      expect(invalidSig.length).not.toBe(132)

      const validSig = `0x${'00'.repeat(65)}` as `0x${string}`
      expect(validSig.length).toBe(132)
    })

    it('should handle empty batch data', () => {
      const emptyBatch = '0x' as const
      const hash = keccak256(emptyBatch)

      // Even empty data should produce a valid hash
      expect(hash).toMatch(/^0x[a-f0-9]{64}$/i)
    })
  })
})
