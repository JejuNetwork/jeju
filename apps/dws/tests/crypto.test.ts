/**
 * Cryptographic Primitives Test Suite
 *
 * Tests for production-ready implementations:
 * - BLS12-381 signatures with pairing verification
 * - KZG polynomial commitments
 * - 2D Reed-Solomon erasure coding
 * - Hash-to-curve (RFC 9380)
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import {
  addG1Points,
  aggregatePublicKeys,
  aggregateSignatures,
  BLOB_SIZE,
  type BLSKeyPair,
  type BLSSignature,
  canReconstruct,
  commitToBlob,
  computeBlobProof,
  computeVersionedHash,
  createBlob,
  createMatrix,
  createProofOfPossession,
  DST_DA_ATTEST,
  derivePublicKey,
  extend2D,
  flattenMatrix,
  G1Generator,
  // BLS
  generateKeyPair,
  gfAdd,
  gfDiv,
  // 2D Reed-Solomon
  gfMul,
  gfPow,
  hashToField,
  // Hash-to-Curve
  hashToG1,
  hashToG2,
  // KZG
  initializeKZG,
  mulG1,
  reconstruct2D,
  sign,
  signAttestation,
  validateBlob,
  validatePublicKey,
  validateSecretKey,
  verify,
  verifyAggregate,
  verifyAttestation,
  verifyBatch,
  verifyBlobProof,
  verifyBlobProofBatch,
  verifyCommitmentForData,
  verifyExtended,
  verifyG1Point,
  verifyG2Point,
  verifyProofOfPossession,
} from '../api/da'

// BLS12-381 Tests

describe('BLS12-381 Signatures', () => {
  let keyPair1: BLSKeyPair
  let keyPair2: BLSKeyPair
  let keyPair3: BLSKeyPair

  beforeAll(() => {
    keyPair1 = generateKeyPair()
    keyPair2 = generateKeyPair()
    keyPair3 = generateKeyPair()
  })

  describe('Key Management', () => {
    test('should generate valid key pairs', () => {
      expect(keyPair1.secretKey).toMatch(/^0x[a-f0-9]{64}$/i)
      expect(keyPair1.publicKey).toMatch(/^0x[a-f0-9]{96}$/i)
    })

    test('should derive public key from secret key', () => {
      const derivedPk = derivePublicKey(keyPair1.secretKey)
      expect(derivedPk).toBe(keyPair1.publicKey)
    })

    test('should validate correct secret keys', () => {
      expect(validateSecretKey(keyPair1.secretKey)).toBe(true)
      expect(validateSecretKey(keyPair2.secretKey)).toBe(true)
    })

    test('should reject invalid secret keys', () => {
      // Zero key is invalid
      const zeroKey = `0x${'00'.repeat(32)}`
      expect(validateSecretKey(zeroKey as `0x${string}`)).toBe(false)
    })

    test('should validate correct public keys', () => {
      expect(validatePublicKey(keyPair1.publicKey)).toBe(true)
      expect(validatePublicKey(keyPair2.publicKey)).toBe(true)
    })
  })

  describe('Signing and Verification', () => {
    const message = new TextEncoder().encode('Hello, BLS!')

    test('should sign and verify messages', () => {
      const signature = sign(keyPair1.secretKey, message)

      expect(signature).toMatch(/^0x[a-f0-9]{192}$/i)
      expect(verify(keyPair1.publicKey, message, signature)).toBe(true)
    })

    test('should reject signatures from wrong key', () => {
      const signature = sign(keyPair1.secretKey, message)

      expect(verify(keyPair2.publicKey, message, signature)).toBe(false)
    })

    test('should reject modified messages', () => {
      const signature = sign(keyPair1.secretKey, message)
      const modifiedMessage = new TextEncoder().encode('Hello, BLS!.')

      expect(verify(keyPair1.publicKey, modifiedMessage, signature)).toBe(false)
    })

    test('should reject modified signatures', () => {
      const signature = sign(keyPair1.secretKey, message)
      // Flip a bit in the signature
      const modifiedSig = `${signature.slice(0, 10)}f${signature.slice(11)}`

      expect(
        verify(keyPair1.publicKey, message, modifiedSig as BLSSignature),
      ).toBe(false)
    })
  })

  describe('Aggregation', () => {
    const message = new TextEncoder().encode('Aggregate test message')

    test('should aggregate signatures', () => {
      const sig1 = sign(keyPair1.secretKey, message)
      const sig2 = sign(keyPair2.secretKey, message)
      const sig3 = sign(keyPair3.secretKey, message)

      const aggregatedSig = aggregateSignatures([sig1, sig2, sig3])
      expect(aggregatedSig).toMatch(/^0x[a-f0-9]{192}$/i)
    })

    test('should verify aggregated signatures', () => {
      const sig1 = sign(keyPair1.secretKey, message)
      const sig2 = sign(keyPair2.secretKey, message)
      const sig3 = sign(keyPair3.secretKey, message)

      const aggregatedSig = aggregateSignatures([sig1, sig2, sig3])
      const publicKeys = [
        keyPair1.publicKey,
        keyPair2.publicKey,
        keyPair3.publicKey,
      ]

      expect(verifyAggregate(publicKeys, message, aggregatedSig)).toBe(true)
    })

    test('should reject incomplete aggregations', () => {
      const sig1 = sign(keyPair1.secretKey, message)
      const sig2 = sign(keyPair2.secretKey, message)

      // Only aggregate two signatures
      const aggregatedSig = aggregateSignatures([sig1, sig2])
      // Try to verify with three public keys
      const publicKeys = [
        keyPair1.publicKey,
        keyPair2.publicKey,
        keyPair3.publicKey,
      ]

      expect(verifyAggregate(publicKeys, message, aggregatedSig)).toBe(false)
    })

    test('should aggregate public keys', () => {
      const aggregatedPk = aggregatePublicKeys([
        keyPair1.publicKey,
        keyPair2.publicKey,
        keyPair3.publicKey,
      ])

      expect(aggregatedPk).toMatch(/^0x[a-f0-9]{96}$/i)
    })
  })

  describe('Batch Verification', () => {
    test('should batch verify multiple signatures', () => {
      const messages = [
        new TextEncoder().encode('Message 1'),
        new TextEncoder().encode('Message 2'),
        new TextEncoder().encode('Message 3'),
      ]

      const signatures = [
        sign(keyPair1.secretKey, messages[0]),
        sign(keyPair2.secretKey, messages[1]),
        sign(keyPair3.secretKey, messages[2]),
      ]

      const publicKeys = [
        keyPair1.publicKey,
        keyPair2.publicKey,
        keyPair3.publicKey,
      ]

      expect(verifyBatch(publicKeys, messages, signatures)).toBe(true)
    })

    test('should reject batch with invalid signature', () => {
      const messages = [
        new TextEncoder().encode('Message 1'),
        new TextEncoder().encode('Message 2'),
        new TextEncoder().encode('Message 3'),
      ]

      const signatures = [
        sign(keyPair1.secretKey, messages[0]),
        sign(keyPair2.secretKey, messages[1]),
        sign(keyPair1.secretKey, messages[2]), // Wrong key!
      ]

      const publicKeys = [
        keyPair1.publicKey,
        keyPair2.publicKey,
        keyPair3.publicKey,
      ]

      expect(verifyBatch(publicKeys, messages, signatures)).toBe(false)
    })
  })

  describe('DA Attestations', () => {
    test('should sign and verify attestations', () => {
      const blobId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const commitment =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const chunkIndices = [0, 1, 2, 3]
      const timestamp = Date.now()

      const signature = signAttestation(
        keyPair1.secretKey,
        blobId,
        commitment,
        chunkIndices,
        timestamp,
      )

      expect(
        verifyAttestation(
          keyPair1.publicKey,
          signature,
          blobId,
          commitment,
          chunkIndices,
          timestamp,
        ),
      ).toBe(true)
    })

    test('should reject attestation with wrong blob ID', () => {
      const blobId =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const wrongBlobId =
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      const commitment =
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const chunkIndices = [0, 1, 2, 3]
      const timestamp = Date.now()

      const signature = signAttestation(
        keyPair1.secretKey,
        blobId,
        commitment,
        chunkIndices,
        timestamp,
      )

      expect(
        verifyAttestation(
          keyPair1.publicKey,
          signature,
          wrongBlobId,
          commitment,
          chunkIndices,
          timestamp,
        ),
      ).toBe(false)
    })
  })

  describe('Proof of Possession', () => {
    test('should create and verify PoP', () => {
      const pop = createProofOfPossession(keyPair1.secretKey)

      expect(pop).toMatch(/^0x[a-f0-9]{192}$/i)
      expect(verifyProofOfPossession(keyPair1.publicKey, pop)).toBe(true)
    })

    test('should reject PoP for wrong public key', () => {
      const pop = createProofOfPossession(keyPair1.secretKey)

      expect(verifyProofOfPossession(keyPair2.publicKey, pop)).toBe(false)
    })
  })
})

// KZG Commitment Tests

describe('KZG Polynomial Commitments', () => {
  beforeAll(async () => {
    await initializeKZG()
  })

  describe('Blob Operations', () => {
    test('should create valid blobs from data', () => {
      const data = new TextEncoder().encode('Hello, KZG!')
      const blob = createBlob(data)

      expect(blob.length).toBe(BLOB_SIZE)
      expect(validateBlob(blob)).toBe(true)
    })

    test('should pad small data to blob size', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const blob = createBlob(data)

      expect(blob.length).toBe(BLOB_SIZE)
      // Check data is at the start
      expect(blob[0]).toBe(1)
      expect(blob[4]).toBe(5)
    })

    test('should reject data larger than blob size', () => {
      const largeData = new Uint8Array(BLOB_SIZE + 1)

      expect(() => createBlob(largeData)).toThrow()
    })
  })

  describe('Commitment Generation', () => {
    test('should compute commitment for blob', async () => {
      const data = new TextEncoder().encode('Commitment test data')
      const { blob, commitment } = commitToBlob(data)

      expect(commitment).toMatch(/^0x[a-f0-9]{96}$/i)
      expect(blob.length).toBe(BLOB_SIZE)
    })

    test('should produce consistent commitments', async () => {
      const data = new TextEncoder().encode('Consistent data')

      const { commitment: c1 } = commitToBlob(data)
      const { commitment: c2 } = commitToBlob(data)

      expect(c1).toBe(c2)
    })

    test('should produce different commitments for different data', async () => {
      const data1 = new TextEncoder().encode('Data 1')
      const data2 = new TextEncoder().encode('Data 2')

      const { commitment: c1 } = commitToBlob(data1)
      const { commitment: c2 } = commitToBlob(data2)

      expect(c1).not.toBe(c2)
    })
  })

  describe('Proof Verification', () => {
    test('should verify valid blob proof', async () => {
      const data = new TextEncoder().encode('Proof verification test')
      const { blob, commitment } = commitToBlob(data)

      const proof = computeBlobProof(blob, commitment)
      expect(verifyBlobProof(blob, commitment, proof)).toBe(true)
    })

    test('should reject invalid proof', async () => {
      const data1 = new TextEncoder().encode('Data 1')
      const data2 = new TextEncoder().encode('Data 2')

      const { blob: blob1, commitment: c1 } = commitToBlob(data1)
      const { commitment: c2 } = commitToBlob(data2)

      // Use proof from blob1 but claim it's for commitment c2
      const proof1 = computeBlobProof(blob1, c1)
      // Wrong commitment for the blob should fail
      expect(verifyBlobProof(blob1, c2, proof1)).toBe(false)
    })

    test('should batch verify proofs', async () => {
      const blobs = [
        commitToBlob(new TextEncoder().encode('Blob 1')),
        commitToBlob(new TextEncoder().encode('Blob 2')),
        commitToBlob(new TextEncoder().encode('Blob 3')),
      ]

      const proofs = blobs.map((b) => computeBlobProof(b.blob, b.commitment))

      expect(
        verifyBlobProofBatch(
          blobs.map((b) => b.blob),
          blobs.map((b) => b.commitment),
          proofs,
        ),
      ).toBe(true)
    })
  })

  describe('Data Verification', () => {
    test('should verify commitment matches data', async () => {
      const data = new TextEncoder().encode('Verify me')
      const { commitment } = commitToBlob(data)

      expect(verifyCommitmentForData(data, commitment)).toBe(true)
    })

    test('should reject wrong data for commitment', async () => {
      const data = new TextEncoder().encode('Original data')
      const wrongData = new TextEncoder().encode('Wrong data')

      const { commitment } = commitToBlob(data)

      expect(verifyCommitmentForData(wrongData, commitment)).toBe(false)
    })
  })

  describe('Versioned Hash', () => {
    test('should compute versioned hash', async () => {
      const data = new TextEncoder().encode('Hash test')
      const { commitment } = commitToBlob(data)

      const versionedHash = computeVersionedHash(commitment)

      expect(versionedHash).toMatch(/^0x[a-f0-9]{64}$/i)
      // Version byte should be 0x01
      expect(versionedHash.startsWith('0x01')).toBe(true)
    })
  })
})

// 2D Reed-Solomon Tests

describe('2D Reed-Solomon Erasure Coding', () => {
  describe('Galois Field Operations', () => {
    test('should compute GF multiplication', () => {
      // GF(2^8) multiplication properties
      expect(gfMul(0, 5)).toBe(0)
      expect(gfMul(1, 5)).toBe(5)
      expect(gfMul(2, 2)).toBe(4)
    })

    test('should compute GF division', () => {
      // a / b = c implies a = b * c
      const a = 100
      const b = 7
      const c = gfDiv(a, b)
      expect(gfMul(b, c)).toBe(a)
    })

    test('should compute GF power', () => {
      expect(gfPow(2, 0)).toBe(1)
      expect(gfPow(2, 1)).toBe(2)
      expect(gfPow(2, 2)).toBe(4)
      expect(gfPow(2, 8)).not.toBe(256) // Should wrap in GF
    })

    test('should compute GF addition (XOR)', () => {
      expect(gfAdd(0, 5)).toBe(5)
      expect(gfAdd(5, 5)).toBe(0) // XOR with self = 0
      expect(gfAdd(0xff, 0xff)).toBe(0)
    })
  })

  describe('Matrix Operations', () => {
    test('should create matrix from linear data', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      const matrix = createMatrix(data, 3, 4, 1)

      expect(matrix.rows).toBe(3)
      expect(matrix.cols).toBe(4)
      expect(matrix.data[0][0][0]).toBe(1)
      expect(matrix.data[2][3][0]).toBe(12)
    })

    test('should flatten matrix back to linear data', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const matrix = createMatrix(original, 2, 4, 1)
      const flattened = flattenMatrix(matrix, original.length)

      expect(flattened).toEqual(original)
    })
  })

  describe('2D Encoding', () => {
    test('should extend matrix with parity', () => {
      const data = new Uint8Array(16)
      for (let i = 0; i < 16; i++) data[i] = i + 1

      const matrix = createMatrix(data, 4, 4, 1)
      const extended = extend2D(matrix, 2, 2)

      expect(extended.dataRows).toBe(4)
      expect(extended.dataCols).toBe(4)
      expect(extended.totalRows).toBe(6)
      expect(extended.totalCols).toBe(6)
    })

    test('should verify extended matrix', () => {
      const data = new Uint8Array(16)
      for (let i = 0; i < 16; i++) data[i] = i + 1

      const matrix = createMatrix(data, 4, 4, 1)
      const extended = extend2D(matrix, 2, 2)

      expect(verifyExtended(extended)).toBe(true)
    })

    test('should detect corrupted parity', () => {
      const data = new Uint8Array(16)
      for (let i = 0; i < 16; i++) data[i] = i + 1

      const matrix = createMatrix(data, 4, 4, 1)
      const extended = extend2D(matrix, 2, 2)

      // Corrupt a parity cell
      extended.data[4][0][0] ^= 0xff

      expect(verifyExtended(extended)).toBe(false)
    })
  })

  describe('Reconstruction', () => {
    test('should check if reconstruction is possible', () => {
      const data = new Uint8Array(16)
      for (let i = 0; i < 16; i++) data[i] = i + 1

      const matrix = createMatrix(data, 4, 4, 1)
      const extended = extend2D(matrix, 2, 2)

      // All cells available
      const allCells = new Map<string, Uint8Array>()
      for (let r = 0; r < extended.totalRows; r++) {
        for (let c = 0; c < extended.totalCols; c++) {
          allCells.set(`${r}:${c}`, extended.data[r][c])
        }
      }

      expect(canReconstruct(extended, allCells)).toBe(true)
    })

    test('should reconstruct from partial data', () => {
      const data = new Uint8Array(16)
      for (let i = 0; i < 16; i++) data[i] = i + 1

      const matrix = createMatrix(data, 4, 4, 1)
      const extended = extend2D(matrix, 2, 2)

      // Create available cells (all except some data cells)
      const available = new Map<string, Uint8Array>()
      for (let r = 0; r < extended.totalRows; r++) {
        for (let c = 0; c < extended.totalCols; c++) {
          // Include enough cells for reconstruction
          if (r < extended.dataRows || c >= extended.dataCols) {
            available.set(`${r}:${c}`, extended.data[r][c])
          }
        }
      }

      const reconstructed = reconstruct2D(extended, available)

      expect(reconstructed.rows).toBe(4)
      expect(reconstructed.cols).toBe(4)
    })
  })
})

// Hash-to-Curve Tests

describe('Hash-to-Curve (RFC 9380)', () => {
  describe('Hash to G1', () => {
    test('should hash message to G1 point', () => {
      const message = new TextEncoder().encode('Test message')
      const point = hashToG1(message)

      expect(point).toMatch(/^0x[a-f0-9]{96}$/i)
      expect(verifyG1Point(point)).toBe(true)
    })

    test('should produce consistent results', () => {
      const message = new TextEncoder().encode('Consistent')

      const p1 = hashToG1(message)
      const p2 = hashToG1(message)

      expect(p1).toBe(p2)
    })

    test('should produce different points for different messages', () => {
      const m1 = new TextEncoder().encode('Message 1')
      const m2 = new TextEncoder().encode('Message 2')

      const p1 = hashToG1(m1)
      const p2 = hashToG1(m2)

      expect(p1).not.toBe(p2)
    })

    test('should respect domain separation tags', () => {
      const message = new TextEncoder().encode('Same message')

      const p1 = hashToG1(message, DST_DA_ATTEST)
      const p2 = hashToG1(message, 'DIFFERENT_DST_')

      expect(p1).not.toBe(p2)
    })
  })

  describe('Hash to G2', () => {
    test('should hash message to G2 point', () => {
      const message = new TextEncoder().encode('Test message')
      const point = hashToG2(message)

      expect(point).toMatch(/^0x[a-f0-9]{192}$/i)
      expect(verifyG2Point(point)).toBe(true)
    })
  })

  describe('Hash to Field', () => {
    test('should hash to field elements', () => {
      const message = new TextEncoder().encode('Field element')
      const elements = hashToField(message, DST_DA_ATTEST, 2)

      expect(elements.length).toBe(2)
      expect(typeof elements[0]).toBe('bigint')
      expect(typeof elements[1]).toBe('bigint')
      // Should be less than field modulus
      expect(
        elements[0] <
          0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n,
      ).toBe(true)
    })
  })

  describe('Point Operations', () => {
    test('should add G1 points', () => {
      const m1 = new TextEncoder().encode('Point 1')
      const m2 = new TextEncoder().encode('Point 2')

      const p1 = hashToG1(m1)
      const p2 = hashToG1(m2)

      const sum = addG1Points(p1, p2)

      expect(verifyG1Point(sum)).toBe(true)
    })

    test('should multiply G1 point by scalar', () => {
      const g = G1Generator()
      const scalar = 12345n

      const result = mulG1(g, scalar)

      expect(verifyG1Point(result)).toBe(true)
    })
  })

  describe('Point Validation', () => {
    test('should validate valid G1 points', () => {
      const message = new TextEncoder().encode('Valid')
      const point = hashToG1(message)

      expect(verifyG1Point(point)).toBe(true)
    })

    test('should reject invalid G1 points', () => {
      // Random bytes that aren't a valid point
      const invalidPoint = `0x${'ff'.repeat(48)}`

      expect(verifyG1Point(invalidPoint as `0x${string}`)).toBe(false)
    })

    test('should validate valid G2 points', () => {
      const message = new TextEncoder().encode('Valid G2')
      const point = hashToG2(message)

      expect(verifyG2Point(point)).toBe(true)
    })

    test('should reject invalid G2 points', () => {
      const invalidPoint = `0x${'ff'.repeat(96)}`

      expect(verifyG2Point(invalidPoint as `0x${string}`)).toBe(false)
    })
  })
})

// Integration Tests

describe('Crypto Integration', () => {
  test('should use BLS with hash-to-curve', () => {
    const keyPair = generateKeyPair()
    const message = new TextEncoder().encode('Integration test')

    // Hash message to curve point
    const hashedMessage = hashToG2(message)
    expect(verifyG2Point(hashedMessage)).toBe(true)

    // Sign the original message (BLS internally hashes to curve)
    const signature = sign(keyPair.secretKey, message)
    expect(verify(keyPair.publicKey, message, signature)).toBe(true)
  })

  test('should encode data with 2D RS and sign commitment', () => {
    const keyPair = generateKeyPair()

    // Create data and encode with 2D Reed-Solomon
    const data = new Uint8Array(64)
    for (let i = 0; i < 64; i++) data[i] = i

    const matrix = createMatrix(data, 8, 8, 1)
    const extended = extend2D(matrix, 4, 4)

    expect(verifyExtended(extended)).toBe(true)

    // Sign the extended matrix root (simulating commitment)
    const matrixRoot = new TextEncoder().encode(
      JSON.stringify({
        rows: extended.totalRows,
        cols: extended.totalCols,
      }),
    )

    const signature = sign(keyPair.secretKey, matrixRoot)
    expect(verify(keyPair.publicKey, matrixRoot, signature)).toBe(true)
  })
})
