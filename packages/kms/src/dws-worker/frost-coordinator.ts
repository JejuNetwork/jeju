/**
 * FROST Coordinator for DWS MPC Workers
 *
 * Implements FROST (Flexible Round-Optimized Schnorr Threshold) signature scheme.
 * This is used by MPC party workers for distributed key generation and signing.
 *
 * Protocol:
 * 1. Key Generation (DKG):
 *    - Each party generates a random polynomial
 *    - Parties exchange commitments, then shares
 *    - Group public key is derived from all contributions
 *
 * 2. Signing:
 *    - Round 1: Each party generates nonce and commitment
 *    - Round 2: Each party generates signature share using all commitments
 *    - Aggregator combines t signature shares into final signature
 */

import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CURVE_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
)

const ZERO = BigInt(0)
const ONE = BigInt(1)
const TWO = BigInt(2)
const EIGHT = BigInt(8)

// ============ Math Helpers ============

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = ONE
  base = ((base % mod) + mod) % mod
  while (exp > ZERO) {
    if (exp % TWO === ONE) result = (result * base) % mod
    exp = exp >> ONE
    base = (base * base) % mod
  }
  return result
}

function modInverse(a: bigint, mod: bigint): bigint {
  return modPow(a, mod - TWO, mod)
}

function lagrangeCoefficient(indices: number[], targetIndex: number): bigint {
  let num = ONE
  let den = ONE
  const xi = BigInt(targetIndex)

  for (const j of indices) {
    if (j !== targetIndex) {
      const xj = BigInt(j)
      const negXj = CURVE_ORDER - xj
      num = (num * negXj) % CURVE_ORDER
      den = (((den * (xi - xj)) % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
    }
  }

  return (num * modInverse(den, CURVE_ORDER)) % CURVE_ORDER
}

function generatePolynomial(secret: bigint, degree: number): bigint[] {
  const coefficients: bigint[] = [secret]
  for (let i = 1; i <= degree; i++) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32))
    let coeff = ZERO
    for (let j = 0; j < 32; j++) {
      coeff = (coeff << EIGHT) | BigInt(randomBytes[j])
    }
    coefficients.push(coeff % CURVE_ORDER)
  }
  return coefficients
}

function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0')
  return toBytes(`0x${hex}` as Hex)
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let result = ZERO
  for (let i = 0; i < bytes.length; i++) {
    result = (result << EIGHT) | BigInt(bytes[i])
  }
  return result
}

// ============ FROST Coordinator ============

export interface KeyGenContribution {
  publicShare: Hex
  commitment: Hex
  secretShare?: Uint8Array // Only stored locally, never transmitted
}

export interface KeyGenResult {
  privateShare: Uint8Array
  publicShare: Hex
  groupPublicKey: Hex
  groupAddress: Address
}

export interface SigningNonce {
  d: bigint
  e: bigint
  D: Hex // Commitment for d
  E: Hex // Commitment for e
}

export class FROSTCoordinator {
  readonly keyId: string
  readonly threshold: number
  readonly totalParties: number

  // DKG state
  private polynomial: bigint[] | null = null
  private privateShare: bigint | null = null
  private publicShares = new Map<number, Hex>()
  private groupPublicKey: Hex | null = null

  // Signing state
  private signingNonces = new Map<string, SigningNonce>()

  constructor(keyId: string, threshold: number, totalParties: number) {
    this.keyId = keyId
    this.threshold = threshold
    this.totalParties = totalParties
  }

  // ============ Key Generation ============

  /**
   * Generate this party's contribution to distributed key generation
   */
  async generateKeyGenContribution(
    _partyIndex: number,
  ): Promise<KeyGenContribution> {
    // Generate random secret and polynomial
    const randomBytes = crypto.getRandomValues(new Uint8Array(32))
    const secret = bytesToBigint(randomBytes) % CURVE_ORDER

    this.polynomial = generatePolynomial(secret, this.threshold - 1)

    // Compute public share (commitment to secret)
    const privateKeyHex =
      `0x${secret.toString(16).padStart(64, '0')}` as `0x${string}`
    const account = privateKeyToAccount(privateKeyHex)
    const publicShare = toHex(account.publicKey)

    // Compute commitment to polynomial coefficients
    const commitment = keccak256(
      toBytes(
        this.polynomial.map((c) => c.toString(16).padStart(64, '0')).join(''),
      ),
    )

    return {
      publicShare,
      commitment,
    }
  }

  /**
   * Finalize key generation with all parties' contributions
   */
  async finalizeKeyGen(
    allPublicShares: Hex[],
    _allCommitments: Hex[],
  ): Promise<KeyGenResult> {
    if (!this.polynomial) {
      throw new Error('Must call generateKeyGenContribution first')
    }

    // In a real implementation:
    // 1. Verify all commitments
    // 2. Exchange encrypted shares with each party
    // 3. Verify received shares against commitments
    // 4. Compute aggregate share

    // For this implementation, we simulate the aggregate
    // In production, each party would receive shares from all others
    let aggregateSecret = ZERO
    for (let i = 0; i < this.polynomial.length; i++) {
      aggregateSecret = (aggregateSecret + this.polynomial[i]) % CURVE_ORDER
    }

    this.privateShare = aggregateSecret

    // Derive group public key from aggregate
    const privateKeyHex =
      `0x${aggregateSecret.toString(16).padStart(64, '0')}` as `0x${string}`
    const account = privateKeyToAccount(privateKeyHex)

    this.groupPublicKey = toHex(account.publicKey)

    // Store public shares
    allPublicShares.forEach((share, idx) => {
      this.publicShares.set(idx + 1, share)
    })

    // Clear polynomial from memory
    const result: KeyGenResult = {
      privateShare: bigintToBytes32(aggregateSecret),
      publicShare: allPublicShares[0], // This party's public share
      groupPublicKey: this.groupPublicKey,
      groupAddress: account.address,
    }

    this.polynomial = null

    return result
  }

  // ============ Signing ============

  /**
   * Generate signing commitment (Round 1 of FROST)
   */
  async generateSigningCommitment(
    partyIndex: number,
    messageHash: Hex,
  ): Promise<{ nonce: Uint8Array; commitment: Hex }> {
    // Generate random nonces d, e
    const dBytes = crypto.getRandomValues(new Uint8Array(32))
    const eBytes = crypto.getRandomValues(new Uint8Array(32))

    const d = bytesToBigint(dBytes) % CURVE_ORDER
    const e = bytesToBigint(eBytes) % CURVE_ORDER

    // Compute commitments D = g^d, E = g^e
    const dKey = `0x${d.toString(16).padStart(64, '0')}` as `0x${string}`
    const eKey = `0x${e.toString(16).padStart(64, '0')}` as `0x${string}`

    const D = toHex(privateKeyToAccount(dKey).publicKey)
    const E = toHex(privateKeyToAccount(eKey).publicKey)

    // Store nonces for round 2
    const sessionKey = `${messageHash}:${partyIndex}`
    this.signingNonces.set(sessionKey, { d, e, D, E })

    // Commitment is hash of D || E
    const commitment = keccak256(toBytes(`${D}${E.slice(2)}`))

    // Combine nonce bytes
    const nonceBytes = new Uint8Array(64)
    nonceBytes.set(dBytes, 0)
    nonceBytes.set(eBytes, 32)

    return {
      nonce: nonceBytes,
      commitment,
    }
  }

  /**
   * Generate signature share (Round 2 of FROST)
   */
  async generateSignatureShare(
    partyIndex: number,
    messageHash: Hex,
    _nonce: Uint8Array,
    allCommitments: { partyIndex: number; commitment: Hex }[],
  ): Promise<Hex> {
    if (!this.privateShare) {
      throw new Error('Key generation not complete')
    }

    const sessionKey = `${messageHash}:${partyIndex}`
    const storedNonce = this.signingNonces.get(sessionKey)

    if (!storedNonce) {
      throw new Error('No nonce found for this signing session')
    }

    // Compute binding factor rho_i = H(i, message, {D_j, E_j})
    const bindingData = allCommitments
      .sort((a, b) => a.partyIndex - b.partyIndex)
      .map((c) => c.commitment)
      .join('')

    const bindingFactor =
      bytesToBigint(
        toBytes(
          keccak256(toBytes(`${partyIndex}${messageHash}${bindingData}`)),
        ),
      ) % CURVE_ORDER

    // Compute group commitment R = sum(D_i + rho_i * E_i)
    // For simplicity, we use D + rho * E for this party
    const R = (storedNonce.d + bindingFactor * storedNonce.e) % CURVE_ORDER

    // Compute challenge c = H(R, Y, message)
    const RKey = `0x${R.toString(16).padStart(64, '0')}` as `0x${string}`
    const RPoint = toHex(privateKeyToAccount(RKey).publicKey)

    const challenge =
      bytesToBigint(
        toBytes(
          keccak256(toBytes(`${RPoint}${this.groupPublicKey}${messageHash}`)),
        ),
      ) % CURVE_ORDER

    // Compute Lagrange coefficient
    const participantIndices = allCommitments.map((c) => c.partyIndex)
    const lambda = lagrangeCoefficient(participantIndices, partyIndex)

    // Compute signature share: z_i = d_i + rho_i * e_i + lambda_i * s_i * c
    const z =
      (storedNonce.d +
        bindingFactor * storedNonce.e +
        lambda * this.privateShare * challenge) %
      CURVE_ORDER

    // Clean up nonce
    this.signingNonces.delete(sessionKey)

    return `0x${z.toString(16).padStart(64, '0')}` as Hex
  }

  /**
   * Aggregate signature shares into final signature (called by coordinator)
   */
  static aggregateSignatures(
    messageHash: Hex,
    _groupPublicKey: Hex,
    commitments: { partyIndex: number; D: Hex; E: Hex }[],
    shares: { partyIndex: number; share: Hex }[],
  ): { r: Hex; s: Hex; v: number } {
    // Compute group commitment R = sum(D_i + rho_i * E_i)
    // This is simplified - real implementation needs EC point addition
    let aggregateR = ZERO
    for (let i = 0; i < commitments.length; i++) {
      const c = commitments[i]
      const bindingFactor =
        bytesToBigint(
          toBytes(keccak256(toBytes(`${c.partyIndex}${messageHash}`))),
        ) % CURVE_ORDER

      // Simplified: would need actual EC operations
      const d = bytesToBigint(toBytes(c.D))
      const e = bytesToBigint(toBytes(c.E))
      aggregateR = (aggregateR + d + bindingFactor * e) % CURVE_ORDER
    }

    // Aggregate signature shares: z = sum(z_i)
    let aggregateS = ZERO
    for (let i = 0; i < shares.length; i++) {
      aggregateS =
        (aggregateS + bytesToBigint(toBytes(shares[i].share))) % CURVE_ORDER
    }

    return {
      r: `0x${aggregateR.toString(16).padStart(64, '0')}` as Hex,
      s: `0x${aggregateS.toString(16).padStart(64, '0')}` as Hex,
      v: 27, // Would be computed based on R.y parity
    }
  }
}
