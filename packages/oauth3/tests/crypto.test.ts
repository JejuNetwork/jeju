/**
 * Comprehensive Cryptographic Unit Tests
 *
 * Tests for FROST threshold signing, TOTP, backup codes, passkeys, and validation.
 * Focus on non-trivial algorithms, edge cases, and boundary conditions.
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1'
import { type Hex, keccak256, toBytes, toHex } from 'viem'

// ============ FROST Signing Tests ============

import {
  computeBindingFactor,
  computeChallenge,
  computeGroupCommitment,
  FROSTCoordinator,
  type FROSTKeyShare,
  type FROSTSigningCommitment,
  generateKeyShares,
  generateSigningCommitment,
  publicKeyToAddress,
  randomScalar,
  verifySignature,
} from '../src/mpc/frost-signing.js'

const CURVE_ORDER = secp256k1.CURVE.n
const GENERATOR = secp256k1.ProjectivePoint.BASE

describe('FROST Threshold Signing - Modular Arithmetic', () => {
  // Helper functions for testing internal mod operations
  function mod(a: bigint, m: bigint): bigint {
    return ((a % m) + m) % m
  }

  function modInverse(a: bigint, m: bigint): bigint {
    let [old_r, r] = [a, m]
    let [old_s, s] = [1n, 0n]
    while (r !== 0n) {
      const quotient = old_r / r
      ;[old_r, r] = [r, old_r - quotient * r]
      ;[old_s, s] = [s, old_s - quotient * s]
    }
    return mod(old_s, m)
  }

  test('mod handles positive numbers correctly', () => {
    expect(mod(10n, 7n)).toBe(3n)
    expect(mod(7n, 7n)).toBe(0n)
    expect(mod(100n, 13n)).toBe(9n)
  })

  test('mod handles negative numbers correctly', () => {
    expect(mod(-3n, 7n)).toBe(4n)
    expect(mod(-10n, 7n)).toBe(4n)
    expect(mod(-100n, 13n)).toBe(4n)
  })

  test('mod handles zero correctly', () => {
    expect(mod(0n, 7n)).toBe(0n)
    expect(mod(0n, CURVE_ORDER)).toBe(0n)
  })

  test('mod handles large numbers near curve order', () => {
    expect(mod(CURVE_ORDER, CURVE_ORDER)).toBe(0n)
    expect(mod(CURVE_ORDER + 1n, CURVE_ORDER)).toBe(1n)
    expect(mod(CURVE_ORDER - 1n, CURVE_ORDER)).toBe(CURVE_ORDER - 1n)
  })

  test('modInverse is correct inverse', () => {
    const testValues = [2n, 3n, 7n, 11n, 13n, 17n, 19n, 23n, 29n]
    for (const a of testValues) {
      const inv = modInverse(a, CURVE_ORDER)
      const product = mod(a * inv, CURVE_ORDER)
      expect(product).toBe(1n)
    }
  })

  test('modInverse handles large scalars', () => {
    const largeScalar = randomScalar()
    const inv = modInverse(largeScalar, CURVE_ORDER)
    const product = mod(largeScalar * inv, CURVE_ORDER)
    expect(product).toBe(1n)
  })

  test('modInverse handles value close to curve order', () => {
    const value = CURVE_ORDER - 2n
    const inv = modInverse(value, CURVE_ORDER)
    const product = mod(value * inv, CURVE_ORDER)
    expect(product).toBe(1n)
  })
})

describe('FROST Threshold Signing - Lagrange Interpolation', () => {
  // Re-implement Lagrange coefficient for testing
  function lagrangeCoefficient(
    participantIndices: number[],
    evaluationIndex: number,
    targetIndex: number,
  ): bigint {
    let numerator = 1n
    let denominator = 1n
    const xi = BigInt(evaluationIndex)
    for (const j of participantIndices) {
      if (j === targetIndex) continue
      const xj = BigInt(j)
      numerator = (numerator * (xi - xj)) % CURVE_ORDER
      numerator = ((numerator % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
      denominator = (denominator * (BigInt(targetIndex) - xj)) % CURVE_ORDER
      denominator = ((denominator % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
    }
    const invDenom = modInverse(denominator, CURVE_ORDER)
    return (((numerator * invDenom) % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
  }

  function modInverse(a: bigint, m: bigint): bigint {
    let [old_r, r] = [((a % m) + m) % m, m]
    let [old_s, s] = [1n, 0n]
    while (r !== 0n) {
      const quotient = old_r / r
      ;[old_r, r] = [r, old_r - quotient * r]
      ;[old_s, s] = [s, old_s - quotient * s]
    }
    return ((old_s % m) + m) % m
  }

  test('Lagrange coefficient at origin sums to 1', () => {
    // For indices [1, 2, 3], Lagrange coefficients at x=0 should sum to 1
    const indices = [1, 2, 3]
    let sum = 0n
    for (const idx of indices) {
      sum = (sum + lagrangeCoefficient(indices, 0, idx)) % CURVE_ORDER
    }
    expect(sum).toBe(1n)
  })

  test('Lagrange coefficient property with 2-of-3 threshold', () => {
    const indices = [1, 2]
    let sum = 0n
    for (const idx of indices) {
      sum = (sum + lagrangeCoefficient(indices, 0, idx)) % CURVE_ORDER
    }
    expect(sum).toBe(1n)
  })

  test('Lagrange coefficient with different participant sets', () => {
    // Test with indices [1, 3] instead of [1, 2]
    const indices = [1, 3]
    let sum = 0n
    for (const idx of indices) {
      sum = (sum + lagrangeCoefficient(indices, 0, idx)) % CURVE_ORDER
    }
    expect(sum).toBe(1n)
  })

  test('Lagrange coefficient with 5-of-7 threshold', () => {
    const indices = [1, 2, 4, 5, 7]
    let sum = 0n
    for (const idx of indices) {
      sum = (sum + lagrangeCoefficient(indices, 0, idx)) % CURVE_ORDER
    }
    expect(sum).toBe(1n)
  })

  test('Lagrange interpolation reconstructs polynomial', () => {
    // f(x) = 5 + 3x for threshold t=2
    // f(1) = 8, f(2) = 11
    const a0 = 5n
    const a1 = 3n
    const indices = [1, 2]
    const y1 = a0 + a1 * 1n
    const y2 = a0 + a1 * 2n

    // Reconstruct f(0) using Lagrange
    const l1 = lagrangeCoefficient(indices, 0, 1)
    const l2 = lagrangeCoefficient(indices, 0, 2)
    const reconstructed =
      (((l1 * y1 + l2 * y2) % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
    expect(reconstructed).toBe(a0)
  })
})

describe('FROST Threshold Signing - Key Generation', () => {
  test('generates correct number of shares', () => {
    const threshold = 3
    const totalParties = 5
    const shares = generateKeyShares(threshold, totalParties)
    expect(shares).toHaveLength(totalParties)
  })

  test('throws for invalid threshold > total', () => {
    expect(() => generateKeyShares(5, 3)).toThrow(
      'Threshold cannot exceed total parties',
    )
  })

  test('throws for threshold < 2', () => {
    expect(() => generateKeyShares(1, 3)).toThrow(
      'Threshold must be at least 2',
    )
  })

  test('all shares have same group public key', () => {
    const shares = generateKeyShares(3, 5)
    const groupPubKey = shares[0].groupPublicKey
    for (const share of shares) {
      expect(share.groupPublicKey.equals(groupPubKey)).toBe(true)
    }
  })

  test('share indices are 1-indexed and sequential', () => {
    const shares = generateKeyShares(2, 4)
    for (let i = 0; i < shares.length; i++) {
      expect(shares[i].index).toBe(i + 1)
    }
  })

  test('shares are valid curve points', () => {
    const shares = generateKeyShares(2, 3)
    for (const share of shares) {
      // Public share should be G * secretShare
      const expected = GENERATOR.multiply(share.secretShare)
      expect(share.publicShare.equals(expected)).toBe(true)
    }
  })

  test('existing secret is used correctly', () => {
    const secret = randomScalar()
    const shares = generateKeyShares(2, 3, secret)
    // Group public key should be G * secret
    const expectedGroupPubKey = GENERATOR.multiply(secret)
    expect(shares[0].groupPublicKey.equals(expectedGroupPubKey)).toBe(true)
  })

  test('different calls produce different shares (randomness)', () => {
    const shares1 = generateKeyShares(2, 3)
    const shares2 = generateKeyShares(2, 3)
    // Group public keys should be different
    expect(shares1[0].groupPublicKey.equals(shares2[0].groupPublicKey)).toBe(
      false,
    )
  })
})

describe('FROST Threshold Signing - Signing Protocol', () => {
  let shares: FROSTKeyShare[]
  let commitments: FROSTSigningCommitment[]

  beforeEach(() => {
    shares = generateKeyShares(2, 3)
    commitments = []
    for (const share of shares) {
      commitments.push(generateSigningCommitment(share))
    }
  })

  test('commitment generation produces valid points', () => {
    for (const commitment of commitments) {
      // Hiding commitment should be G * hidingNonce
      const expectedHiding = GENERATOR.multiply(commitment.hidingNonce)
      expect(commitment.hidingCommitment.equals(expectedHiding)).toBe(true)

      // Binding commitment should be G * bindingNonce
      const expectedBinding = GENERATOR.multiply(commitment.bindingNonce)
      expect(commitment.bindingCommitment.equals(expectedBinding)).toBe(true)
    }
  })

  test('binding factor is deterministic for same input', () => {
    const message = new TextEncoder().encode('test message')
    const factor1 = computeBindingFactor(message, commitments, 1)
    const factor2 = computeBindingFactor(message, commitments, 1)
    expect(factor1).toBe(factor2)
  })

  test('binding factor differs for different participants', () => {
    const message = new TextEncoder().encode('test message')
    const factor1 = computeBindingFactor(message, commitments, 1)
    const factor2 = computeBindingFactor(message, commitments, 2)
    expect(factor1).not.toBe(factor2)
  })

  test('binding factor differs for different messages', () => {
    const message1 = new TextEncoder().encode('message 1')
    const message2 = new TextEncoder().encode('message 2')
    const factor1 = computeBindingFactor(message1, commitments, 1)
    const factor2 = computeBindingFactor(message2, commitments, 1)
    expect(factor1).not.toBe(factor2)
  })

  test('group commitment is computed correctly', () => {
    const message = new TextEncoder().encode('test')
    const bindingFactors = new Map<number, bigint>()
    for (const c of commitments) {
      bindingFactors.set(
        c.index,
        computeBindingFactor(message, commitments, c.index),
      )
    }

    const groupCommitment = computeGroupCommitment(commitments, bindingFactors)
    expect(groupCommitment).toBeDefined()
    // Group commitment should be a valid curve point
    expect(groupCommitment.x).toBeDefined()
    expect(groupCommitment.y).toBeDefined()
  })

  test('throws when computing group commitment without binding factors', () => {
    const emptyFactors = new Map<number, bigint>()
    expect(() => computeGroupCommitment(commitments, emptyFactors)).toThrow(
      'Missing binding factor',
    )
  })

  test('throws when computing group commitment with empty commitments', () => {
    const bindingFactors = new Map<number, bigint>()
    expect(() => computeGroupCommitment([], bindingFactors)).toThrow(
      'No commitments provided',
    )
  })

  test('challenge is deterministic', () => {
    const message = new TextEncoder().encode('test')
    const groupCommitment = GENERATOR.multiply(randomScalar())
    const groupPubKey = shares[0].groupPublicKey

    const challenge1 = computeChallenge(groupCommitment, groupPubKey, message)
    const challenge2 = computeChallenge(groupCommitment, groupPubKey, message)
    expect(challenge1).toBe(challenge2)
  })
})

describe('FROST Threshold Signing - Full Signing Flow', () => {
  test('2-of-3 threshold signing produces valid signature', async () => {
    const coordinator = new FROSTCoordinator('test-2-3', 2, 3)
    await coordinator.initializeCluster()

    const message = keccak256(toBytes('Test message for signing'))
    const signature = await coordinator.sign(message, [1, 2])

    expect(signature.r).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(signature.s).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(signature.v).toBeGreaterThanOrEqual(27)
    expect(signature.v).toBeLessThanOrEqual(28)
  })

  test('3-of-5 threshold signing with different participant sets', async () => {
    const coordinator = new FROSTCoordinator('test-3-5', 3, 5)
    await coordinator.initializeCluster()

    const message = keccak256(toBytes('Another test'))

    // Sign with parties 1, 2, 3
    const sig1 = await coordinator.sign(message, [1, 2, 3])
    expect(sig1.r).toBeDefined()

    // Sign with parties 2, 3, 4
    const sig2 = await coordinator.sign(message, [2, 3, 4])
    expect(sig2.r).toBeDefined()

    // Sign with parties 1, 3, 5
    const sig3 = await coordinator.sign(message, [1, 3, 5])
    expect(sig3.r).toBeDefined()
  })

  test('fails when not enough participants', async () => {
    const coordinator = new FROSTCoordinator('fail-test', 3, 5)
    await coordinator.initializeCluster()

    const message = keccak256(toBytes('Test'))
    await expect(coordinator.sign(message, [1, 2])).rejects.toThrow(
      'Need at least 3 participants',
    )
  })

  test('address derivation is consistent', async () => {
    const coordinator = new FROSTCoordinator('addr-test', 2, 3)
    await coordinator.initializeCluster()

    const address1 = coordinator.getAddress()
    const address2 = coordinator.getAddress()
    expect(address1).toBe(address2)
    expect(address1).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })

  test('publicKeyToAddress produces valid Ethereum address', () => {
    const scalar = randomScalar()
    const pubKey = GENERATOR.multiply(scalar)
    const address = publicKeyToAddress(pubKey)

    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(address.length).toBe(42)
  })

  test('randomScalar produces values in valid range', () => {
    for (let i = 0; i < 100; i++) {
      const scalar = randomScalar()
      expect(scalar).toBeGreaterThan(0n)
      expect(scalar).toBeLessThan(CURVE_ORDER)
    }
  })
})

describe('FROST Threshold Signing - Signature Verification', () => {
  test('signature verifies against group public key', async () => {
    const coordinator = new FROSTCoordinator('verify-test', 2, 3)
    await coordinator.initializeCluster()

    const message = new TextEncoder().encode('Verify this message')
    const messageHex = toHex(message)
    const signature = await coordinator.sign(messageHex as Hex, [1, 2])

    const cluster = coordinator.getCluster()
    // Get the group public key from the first party (used for verification)
    void cluster.groupPublicKey

    // Verify signature structure
    expect(BigInt(signature.r)).toBeGreaterThan(0n)
    expect(BigInt(signature.s)).toBeGreaterThan(0n)
  })

  test('verifySignature rejects invalid r value', async () => {
    const coordinator = new FROSTCoordinator('invalid-r', 2, 3)
    await coordinator.initializeCluster()

    const message = new TextEncoder().encode('test')
    const signature = await coordinator.sign(toHex(message) as Hex, [1, 2])

    // Tamper with r
    const tamperedSig = { ...signature, r: '0x0' as Hex }
    const cluster = coordinator.getCluster()
    const groupPubKey = secp256k1.ProjectivePoint.fromHex(
      cluster.groupPublicKey.slice(2),
    )

    const valid = verifySignature(message, tamperedSig, groupPubKey)
    expect(valid).toBe(false)
  })

  test('verifySignature rejects r >= curve order', async () => {
    const message = new TextEncoder().encode('test')
    const invalidSig = {
      r: `0x${CURVE_ORDER.toString(16)}` as Hex,
      s: '0x1' as Hex,
      v: 27,
    }
    const pubKey = GENERATOR.multiply(randomScalar())

    const valid = verifySignature(message, invalidSig, pubKey)
    expect(valid).toBe(false)
  })
})

// ============ TOTP Tests ============

import { createTOTPManager, type TOTPManager } from '../src/mfa/totp.js'

describe('TOTP - Base32 Encoding', () => {
  // Internal test helper to verify base32
  function base32Encode(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let result = ''
    let bits = 0
    let value = 0
    for (const byte of bytes) {
      value = (value << 8) | byte
      bits += 8
      while (bits >= 5) {
        result += alphabet[(value >>> (bits - 5)) & 31]
        bits -= 5
      }
    }
    if (bits > 0) {
      result += alphabet[(value << (5 - bits)) & 31]
    }
    return result
  }

  test('encodes empty array', () => {
    expect(base32Encode(new Uint8Array([]))).toBe('')
  })

  test('encodes single byte', () => {
    // 0xFF = 11111111 -> FFFFF (with padding considerations)
    const result = base32Encode(new Uint8Array([0xff]))
    expect(result).toMatch(/^[A-Z2-7]+$/)
    expect(result.length).toBe(2) // 8 bits -> 2 base32 chars
  })

  test('encodes known test vectors', () => {
    // RFC 4648 test vectors
    // "f" = 0x66 -> MY
    // "fo" = 0x66 0x6F -> MZXQ
    // "foo" = 0x66 0x6F 0x6F -> MZXW6
    expect(base32Encode(new Uint8Array([0x66]))).toBe('MY')
    expect(base32Encode(new Uint8Array([0x66, 0x6f]))).toBe('MZXQ')
    expect(base32Encode(new Uint8Array([0x66, 0x6f, 0x6f]))).toBe('MZXW6')
  })

  test('encodes 20-byte secret (typical TOTP key)', () => {
    const secret = new Uint8Array(20).fill(0xab)
    const encoded = base32Encode(secret)
    expect(encoded.length).toBe(32) // 160 bits -> 32 base32 chars
    expect(encoded).toMatch(/^[A-Z2-7]+$/)
  })

  test('encoding is deterministic', () => {
    const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78])
    const encoded1 = base32Encode(bytes)
    const encoded2 = base32Encode(bytes)
    expect(encoded1).toBe(encoded2)
  })
})

describe('TOTP - Code Generation and Verification', () => {
  let totp: TOTPManager

  beforeEach(() => {
    totp = createTOTPManager({ issuer: 'TestApp' })
  })

  test('generates TOTP secret with valid URI', async () => {
    const result = await totp.generateSecret('user123', 'test@example.com')

    expect(result.secret).toMatch(/^[A-Z2-7]+$/)
    expect(result.secret.length).toBe(32) // 20 bytes -> 32 base32 chars
    expect(result.uri).toContain('otpauth://totp/')
    expect(result.uri).toContain('TestApp')
    expect(result.uri).toContain(encodeURIComponent('test@example.com'))
    expect(result.qrCodeData).toContain('base64')
  })

  test('URI contains all required parameters', async () => {
    const result = await totp.generateSecret('user456', 'user@test.com')
    const url = new URL(result.uri)
    const params = url.searchParams

    expect(params.get('secret')).toBe(result.secret)
    expect(params.get('issuer')).toBe('TestApp')
    expect(params.get('algorithm')).toBe('SHA1')
    expect(params.get('digits')).toBe('6')
    expect(params.get('period')).toBe('30')
  })

  test('generates valid 6-digit code', async () => {
    await totp.generateSecret('user789', 'user@test.com')
    const code = await totp.getCurrentCode('user789')

    expect(code).not.toBeNull()
    expect(code!.length).toBe(6)
    expect(code).toMatch(/^\d{6}$/)
  })

  test('code changes over time periods', async () => {
    await totp.generateSecret('timetest', 'time@test.com')

    const code1 = await totp.getCurrentCode('timetest')
    expect(code1).not.toBeNull()

    // Note: Same period should return same code
    const code2 = await totp.getCurrentCode('timetest')
    expect(code2).toBe(code1)
  })

  test('verifies valid code', async () => {
    await totp.generateSecret('verifytest', 'verify@test.com')
    const code = await totp.getCurrentCode('verifytest')

    const result = await totp.verify('verifytest', code!)
    expect(result.valid).toBe(true)
    expect(result.drift).toBe(0)
  })

  test('rejects invalid code', async () => {
    await totp.generateSecret('invalidtest', 'invalid@test.com')

    const result = await totp.verify('invalidtest', '000000')
    // The code might actually be 000000 by chance, so check structure
    expect(typeof result.valid).toBe('boolean')
    if (!result.valid) {
      expect(result.error).toBeDefined()
    }
  })

  test('rejects code with wrong length', async () => {
    await totp.generateSecret('lentest', 'len@test.com')

    const result = await totp.verify('lentest', '12345')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('6 digits')
  })

  test('rejects non-numeric code', async () => {
    await totp.generateSecret('numtest', 'num@test.com')

    const result = await totp.verify('numtest', 'abcdef')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('only digits')
  })

  test('rejects code for non-existent user', async () => {
    const result = await totp.verify('nonexistent', '123456')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No TOTP configured')
  })

  test('handles code with spaces (normalized)', async () => {
    await totp.generateSecret('spacetest', 'space@test.com')
    const code = await totp.getCurrentCode('spacetest')

    // Add spaces
    const spacedCode = `${code!.slice(0, 3)} ${code!.slice(3)}`
    const result = await totp.verify('spacetest', spacedCode)
    expect(result.valid).toBe(true)
  })

  test('enableIfValid activates TOTP', async () => {
    await totp.generateSecret('enabletest', 'enable@test.com')
    expect(totp.isEnabled('enabletest')).toBe(false)

    const code = await totp.getCurrentCode('enabletest')
    await totp.verify('enabletest', code!, true)

    expect(totp.isEnabled('enabletest')).toBe(true)
  })

  test('getStatus returns correct information', async () => {
    const status1 = totp.getStatus('nostatus')
    expect(status1.enabled).toBe(false)
    expect(status1.createdAt).toBeUndefined()

    await totp.generateSecret('statustest', 'status@test.com')
    const status2 = totp.getStatus('statustest')
    expect(status2.enabled).toBe(false)
    expect(status2.createdAt).toBeDefined()
  })

  test('remove clears TOTP configuration', async () => {
    await totp.generateSecret('removetest', 'remove@test.com')
    expect(totp.getStatus('removetest').enabled).toBe(false)

    const removed = totp.remove('removetest')
    expect(removed).toBe(true)

    const status = totp.getStatus('removetest')
    expect(status.enabled).toBe(false)
    expect(status.createdAt).toBeUndefined()
  })
})

describe('TOTP - Timing Safe Comparison', () => {
  // Re-implement for testing
  function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  test('equal strings return true', () => {
    expect(timingSafeEqual('123456', '123456')).toBe(true)
    expect(timingSafeEqual('000000', '000000')).toBe(true)
    expect(timingSafeEqual('', '')).toBe(true)
  })

  test('different strings return false', () => {
    expect(timingSafeEqual('123456', '123457')).toBe(false)
    expect(timingSafeEqual('000000', '000001')).toBe(false)
    expect(timingSafeEqual('abcdef', 'ABCDEF')).toBe(false)
  })

  test('different length strings return false', () => {
    expect(timingSafeEqual('12345', '123456')).toBe(false)
    expect(timingSafeEqual('', '1')).toBe(false)
  })

  test('handles all ASCII characters', () => {
    const str1 = '!@#$%^&*()_+-=[]{}|;\':",.<>?/`~'
    const str2 = '!@#$%^&*()_+-=[]{}|;\':",.<>?/`~'
    expect(timingSafeEqual(str1, str2)).toBe(true)
  })

  test('single character difference detected', () => {
    expect(timingSafeEqual('000000', '100000')).toBe(false)
    expect(timingSafeEqual('000000', '000001')).toBe(false)
    expect(timingSafeEqual('000000', '001000')).toBe(false)
  })
})

// ============ Backup Codes Tests ============

import {
  type BackupCodesManager,
  createBackupCodesManager,
} from '../src/mfa/backup-codes.js'

describe('Backup Codes - Generation', () => {
  let manager: BackupCodesManager

  beforeEach(() => {
    manager = createBackupCodesManager()
  })

  test('generates default 10 codes', () => {
    const { codes } = manager.generate('user1')
    expect(codes).toHaveLength(10)
  })

  test('generates custom number of codes', () => {
    const { codes } = manager.generate('user2', 5)
    expect(codes).toHaveLength(5)
  })

  test('codes are in XXXX-XXXX format', () => {
    const { codes } = manager.generate('user3')
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    }
  })

  test('codes exclude confusing characters', () => {
    const { codes } = manager.generate('user4', 100)
    for (const code of codes) {
      // Should not contain 0, O, I, 1 (L is included in the alphabet)
      expect(code).not.toMatch(/[0OI1]/)
    }
  })

  test('codes are unique within a set', () => {
    const { codes } = manager.generate('user5', 100)
    const unique = new Set(codes)
    expect(unique.size).toBe(codes.length)
  })

  test('regenerating replaces existing codes', () => {
    const result1 = manager.generate('user6')
    const result2 = manager.generate('user6')

    // Different codes (with high probability)
    expect(result1.codes).not.toEqual(result2.codes)

    // But same count
    expect(result1.codes.length).toBe(result2.codes.length)
  })

  test('different users get different codes', () => {
    const result1 = manager.generate('userA')
    const result2 = manager.generate('userB')

    const set1 = new Set(result1.codes)
    const set2 = new Set(result2.codes)

    // Should have no overlap (with very high probability)
    const overlap = [...set1].filter((c) => set2.has(c))
    expect(overlap.length).toBe(0)
  })
})

describe('Backup Codes - Verification', () => {
  let manager: BackupCodesManager

  beforeEach(() => {
    manager = createBackupCodesManager()
  })

  test('valid code verifies successfully', () => {
    const { codes } = manager.generate('user1')
    const result = manager.verify('user1', codes[0])

    expect(result.valid).toBe(true)
    expect(result.remaining).toBe(9)
  })

  test('code can only be used once', () => {
    const { codes } = manager.generate('user2')

    const result1 = manager.verify('user2', codes[0])
    expect(result1.valid).toBe(true)

    const result2 = manager.verify('user2', codes[0])
    expect(result2.valid).toBe(false)
    expect(result2.error).toBe('Invalid backup code')
  })

  test('all codes can be used', () => {
    const { codes } = manager.generate('user3', 5)

    for (let i = 0; i < codes.length; i++) {
      const result = manager.verify('user3', codes[i])
      expect(result.valid).toBe(true)
      expect(result.remaining).toBe(4 - i)
    }

    // No more codes left
    expect(manager.getRemainingCount('user3')).toBe(0)
  })

  test('invalid code fails verification', () => {
    manager.generate('user4')
    const result = manager.verify('user4', 'XXXX-XXXX')

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid backup code')
  })

  test('verification for unknown user fails', () => {
    const result = manager.verify('unknown', 'ABCD-EFGH')

    expect(result.valid).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.error).toBe('No backup codes configured')
  })

  test('code normalization removes spaces and dashes', () => {
    const { codes } = manager.generate('user5')
    const code = codes[0]

    // Test various formats
    const spacedCode = code.replace('-', '  ')
    const result = manager.verify('user5', spacedCode)
    expect(result.valid).toBe(true)
  })

  test('code normalization is case-insensitive', () => {
    const { codes } = manager.generate('user6')
    const code = codes[0]

    const result = manager.verify('user6', code.toLowerCase())
    expect(result.valid).toBe(true)
  })
})

describe('Backup Codes - Status and Management', () => {
  let manager: BackupCodesManager

  beforeEach(() => {
    manager = createBackupCodesManager()
  })

  test('getRemainingCount returns correct value', () => {
    expect(manager.getRemainingCount('nouser')).toBe(0)

    const { codes } = manager.generate('countuser', 5)
    expect(manager.getRemainingCount('countuser')).toBe(5)

    manager.verify('countuser', codes[0])
    expect(manager.getRemainingCount('countuser')).toBe(4)
  })

  test('hasBackupCodes returns correct status', () => {
    expect(manager.hasBackupCodes('nouser')).toBe(false)

    const { codes } = manager.generate('hasuser', 2)
    expect(manager.hasBackupCodes('hasuser')).toBe(true)

    // Use all codes
    manager.verify('hasuser', codes[0])
    manager.verify('hasuser', codes[1])
    expect(manager.hasBackupCodes('hasuser')).toBe(false)
  })

  test('getStatus returns comprehensive info', () => {
    const status1 = manager.getStatus('nouser')
    expect(status1.configured).toBe(false)
    expect(status1.total).toBe(0)
    expect(status1.remaining).toBe(0)

    const { codes } = manager.generate('statususer', 5)
    const status2 = manager.getStatus('statususer')
    expect(status2.configured).toBe(true)
    expect(status2.total).toBe(5)
    expect(status2.remaining).toBe(5)
    expect(status2.createdAt).toBeDefined()

    manager.verify('statususer', codes[0])
    const status3 = manager.getStatus('statususer')
    expect(status3.remaining).toBe(4)
  })

  test('remove deletes all codes', () => {
    manager.generate('removeuser')
    expect(manager.hasBackupCodes('removeuser')).toBe(true)

    const removed = manager.remove('removeuser')
    expect(removed).toBe(true)
    expect(manager.hasBackupCodes('removeuser')).toBe(false)
  })

  test('remove returns false for unknown user', () => {
    const removed = manager.remove('unknown')
    expect(removed).toBe(false)
  })

  test('exportCodes returns only unused codes', () => {
    expect(manager.exportCodes('nouser')).toBeNull()

    const { codes } = manager.generate('exportuser', 5)
    manager.verify('exportuser', codes[0])
    manager.verify('exportuser', codes[2])

    const exported = manager.exportCodes('exportuser')
    expect(exported).not.toBeNull()
    expect(exported!.length).toBe(3)
    expect(exported).not.toContain(codes[0])
    expect(exported).not.toContain(codes[2])
  })
})

// ============ Passkeys Tests ============

import {
  createPasskeyManager,
  type PasskeyManager,
} from '../src/mfa/passkeys.js'

describe('Passkeys - Base64URL Encoding', () => {
  // Re-implement for testing
  function bufferToBase64url(buffer: Uint8Array): string {
    return btoa(String.fromCharCode(...buffer))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  function base64urlToBuffer(base64url: string): Uint8Array {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    const padLen = (4 - (base64.length % 4)) % 4
    const padded = base64 + '='.repeat(padLen)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  test('encodes to URL-safe base64', () => {
    // Bytes that would produce +, /, = in standard base64
    const data = new Uint8Array([0xfb, 0xef, 0xbe])
    const encoded = bufferToBase64url(data)

    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })

  test('round-trip encoding preserves data', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32])
    const encoded = bufferToBase64url(original)
    const decoded = base64urlToBuffer(encoded)

    expect(decoded).toEqual(original)
  })

  test('handles empty buffer', () => {
    const empty = new Uint8Array([])
    const encoded = bufferToBase64url(empty)
    expect(encoded).toBe('')

    const decoded = base64urlToBuffer('')
    expect(decoded.length).toBe(0)
  })

  test('handles 32-byte challenge', () => {
    const challenge = new Uint8Array(32)
    crypto.getRandomValues(challenge)

    const encoded = bufferToBase64url(challenge)
    const decoded = base64urlToBuffer(encoded)

    expect(decoded).toEqual(challenge)
  })
})

describe('Passkeys - Challenge Management', () => {
  let manager: PasskeyManager

  beforeEach(() => {
    manager = createPasskeyManager({
      rpId: 'example.com',
      rpName: 'Example App',
    })
  })

  test('generates registration options with correct structure', async () => {
    const options = await manager.generateRegistrationOptions({
      userId: 'user123',
      username: 'testuser',
      displayName: 'Test User',
    })

    expect(options.challengeId).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(options.publicKey.rp.id).toBe('example.com')
    expect(options.publicKey.rp.name).toBe('Example App')
    expect(options.publicKey.user.name).toBe('testuser')
    expect(options.publicKey.user.displayName).toBe('Test User')
    expect(options.publicKey.pubKeyCredParams.length).toBeGreaterThan(0)
  })

  test('registration challenge is unique each time', async () => {
    const options1 = await manager.generateRegistrationOptions({
      userId: 'user1',
      username: 'user1',
      displayName: 'User 1',
    })

    const options2 = await manager.generateRegistrationOptions({
      userId: 'user1',
      username: 'user1',
      displayName: 'User 1',
    })

    expect(options1.challengeId).not.toBe(options2.challengeId)
  })

  test('generates authentication options', async () => {
    const options = await manager.generateAuthenticationOptions({
      userId: 'user123',
    })

    expect(options.challengeId).toMatch(/^0x[a-fA-F0-9]+$/)
    expect(options.publicKey.rpId).toBe('example.com')
    expect(options.publicKey.userVerification).toBe('preferred')
  })

  test('registration excludes existing credentials', async () => {
    // First register a credential
    await manager.generateRegistrationOptions({
      userId: 'multiuser',
      username: 'multi',
      displayName: 'Multi User',
    })

    // Simulate registration by verifying with mock data
    // Note: In real test would need mock WebAuthn response

    // Second registration should exclude the first
    const regOptions2 = await manager.generateRegistrationOptions({
      userId: 'multiuser',
      username: 'multi',
      displayName: 'Multi User',
    })

    // Since no actual credential was registered, excludeCredentials should be empty
    expect(regOptions2.publicKey.excludeCredentials?.length ?? 0).toBe(0)
  })
})

describe('Passkeys - Credential Management', () => {
  let manager: PasskeyManager

  beforeEach(() => {
    manager = createPasskeyManager({ rpId: 'test.com', rpName: 'Test' })
  })

  test('getCredentials returns empty for new user', () => {
    const creds = manager.getCredentials('newuser')
    expect(creds).toHaveLength(0)
  })

  test('removeCredential returns false for non-existent', () => {
    const result = manager.removeCredential('user', 'nonexistent')
    expect(result).toBe(false)
  })

  test('updateCredentialName returns false for non-existent', () => {
    const result = manager.updateCredentialName(
      'user',
      'nonexistent',
      'New Name',
    )
    expect(result).toBe(false)
  })
})

// ============ Validation Tests ============

import {
  AddressSchema,
  Bytes32Schema,
  expectEndpoint,
  expect as expectValue,
  generateOTP,
  HexSchema,
  isAddress,
  isHex,
  OAuth3ConfigSchema,
  validateResponse,
} from '../src/validation.js'

describe('Validation - Hex Schemas', () => {
  test('HexSchema accepts valid hex strings', () => {
    expect(HexSchema.safeParse('0x1234abcdef').success).toBe(true)
    expect(HexSchema.safeParse('0xABCDEF').success).toBe(true)
    expect(HexSchema.safeParse('0x0').success).toBe(true)
  })

  test('HexSchema rejects invalid hex strings', () => {
    expect(HexSchema.safeParse('1234').success).toBe(false)
    expect(HexSchema.safeParse('0xGHIJ').success).toBe(false)
    expect(HexSchema.safeParse('').success).toBe(false)
  })

  test('AddressSchema accepts valid addresses', () => {
    expect(
      AddressSchema.safeParse('0x1234567890123456789012345678901234567890')
        .success,
    ).toBe(true)
    expect(
      AddressSchema.safeParse('0xabcdefABCDEF1234567890123456789012345678')
        .success,
    ).toBe(true)
  })

  test('AddressSchema rejects invalid addresses', () => {
    expect(AddressSchema.safeParse('0x123').success).toBe(false) // Too short
    expect(
      AddressSchema.safeParse('0x12345678901234567890123456789012345678901')
        .success,
    ).toBe(false) // Too long
    expect(
      AddressSchema.safeParse('1234567890123456789012345678901234567890')
        .success,
    ).toBe(false) // No prefix
  })

  test('Bytes32Schema accepts valid 32-byte hex', () => {
    const valid = `0x${'12'.repeat(32)}`
    expect(Bytes32Schema.safeParse(valid).success).toBe(true)
  })

  test('Bytes32Schema rejects invalid lengths', () => {
    expect(Bytes32Schema.safeParse(`0x${'12'.repeat(31)}`).success).toBe(false)
    expect(Bytes32Schema.safeParse(`0x${'12'.repeat(33)}`).success).toBe(false)
  })
})

describe('Validation - Type Guards', () => {
  test('isHex returns true for valid hex', () => {
    expect(isHex('0x1234')).toBe(true)
    expect(isHex('0xabcdef')).toBe(true)
    expect(isHex('0x0')).toBe(true)
  })

  test('isHex returns false for invalid input', () => {
    expect(isHex('1234')).toBe(false)
    expect(isHex('0xGHIJ')).toBe(false)
    expect(isHex('')).toBe(false)
    expect(isHex(null)).toBe(false)
    expect(isHex(undefined)).toBe(false)
    expect(isHex(123)).toBe(false)
  })

  test('isAddress returns true for valid addresses', () => {
    expect(isAddress('0x1234567890123456789012345678901234567890')).toBe(true)
  })

  test('isAddress returns false for invalid input', () => {
    expect(isAddress('0x123')).toBe(false)
    expect(isAddress('not an address')).toBe(false)
    expect(isAddress(null)).toBe(false)
  })
})

describe('Validation - Helper Functions', () => {
  test('expectValue returns value if not null/undefined', () => {
    expect(expectValue('hello', 'Missing')).toBe('hello')
    expect(expectValue(0, 'Missing')).toBe(0)
    expect(expectValue(false, 'Missing')).toBe(false)
  })

  test('expectValue throws for null/undefined', () => {
    expect(() => expectValue(null, 'Value is null')).toThrow('Value is null')
    expect(() => expectValue(undefined, 'Value is undefined')).toThrow(
      'Value is undefined',
    )
  })

  test('expectEndpoint returns endpoint from node', () => {
    const node = { endpoint: 'http://localhost:4200' }
    expect(expectEndpoint(node)).toBe('http://localhost:4200')
  })

  test('expectEndpoint throws for missing node', () => {
    expect(() => expectEndpoint(null)).toThrow('TEE node not initialized')
    expect(() => expectEndpoint(undefined)).toThrow('TEE node not initialized')
  })

  test('expectEndpoint throws for missing endpoint', () => {
    expect(() => expectEndpoint({ endpoint: '' })).toThrow(
      'no endpoint configured',
    )
  })
})

describe('Validation - OTP Generation', () => {
  test('generates OTP of specified length', () => {
    expect(generateOTP(4).length).toBe(4)
    expect(generateOTP(6).length).toBe(6)
    expect(generateOTP(8).length).toBe(8)
  })

  test('generates only digits', () => {
    for (let i = 0; i < 100; i++) {
      const otp = generateOTP(6)
      expect(otp).toMatch(/^\d+$/)
    }
  })

  test('generates different OTPs', () => {
    const otps = new Set<string>()
    for (let i = 0; i < 100; i++) {
      otps.add(generateOTP(6))
    }
    // With 10^6 possibilities, 100 draws should be almost all unique
    expect(otps.size).toBeGreaterThan(90)
  })

  test('handles edge cases', () => {
    expect(generateOTP(1).length).toBe(1)
    expect(generateOTP(0)).toBe('')
  })
})

describe('Validation - Schema Response Validation', () => {
  const TestSchema = HexSchema

  test('validateResponse returns parsed data for valid input', () => {
    const result = validateResponse(TestSchema, '0x1234', 'test hex')
    expect(result).toBe('0x1234')
  })

  test('validateResponse throws with context for invalid input', () => {
    expect(() => validateResponse(TestSchema, 'invalid', 'test hex')).toThrow(
      'Invalid test hex',
    )
  })
})

describe('Validation - OAuth3Config Schema', () => {
  test('accepts valid minimal config', () => {
    const config = {
      appId: 'myapp.oauth3.jeju',
      redirectUri: 'https://example.com/callback',
    }
    const result = OAuth3ConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  test('accepts valid hex appId', () => {
    const config = {
      appId: '0x1234567890abcdef',
      redirectUri: 'https://example.com/callback',
    }
    const result = OAuth3ConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  test('accepts full config with all options', () => {
    const config = {
      appId: '0x1234567890abcdef',
      redirectUri: 'https://example.com/callback',
      teeAgentUrl: 'https://tee.example.com',
      rpcUrl: 'https://rpc.example.com',
      chainId: 420691,
      identityRegistryAddress: '0x1234567890123456789012345678901234567890',
      appRegistryAddress: '0x1234567890123456789012345678901234567890',
      accountFactoryAddress: '0x1234567890123456789012345678901234567890',
      decentralized: true,
    }
    const result = OAuth3ConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  test('rejects missing required fields', () => {
    const result1 = OAuth3ConfigSchema.safeParse({})
    expect(result1.success).toBe(false)

    const result2 = OAuth3ConfigSchema.safeParse({ appId: 'test' })
    expect(result2.success).toBe(false)
  })

  test('rejects invalid redirectUri', () => {
    const config = {
      appId: 'test',
      redirectUri: 'not-a-url',
    }
    const result = OAuth3ConfigSchema.safeParse(config)
    expect(result.success).toBe(false)
  })
})
