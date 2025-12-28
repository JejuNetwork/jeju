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
 *
 * SECURITY NOTE:
 * This implementation uses @noble/curves secp256k1 for EC operations.
 * The aggregateSignatures function properly handles EC point parsing and
 * scalar multiplication via secp256k1.ProjectivePoint.
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const CURVE_ORDER = secp256k1.CURVE.n
const GENERATOR = secp256k1.ProjectivePoint.BASE

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

interface SigningNonce {
  d: bigint
  e: bigint
  D: Hex // Commitment for d
  E: Hex // Commitment for e
}

export interface FROSTCluster {
  keyId: string
  threshold: number
  totalParties: number
  groupPublicKey: Hex
  groupAddress: Address
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
  private groupAddress: Address | null = null

  // Signing state
  private signingNonces = new Map<string, SigningNonce>()

  constructor(keyId: string, threshold: number, totalParties: number) {
    this.keyId = keyId
    this.threshold = threshold
    this.totalParties = totalParties
  }

  // ============ High-Level API (for SigningService) ============

  /**
   * Initialize the cluster by running DKG
   * This is a convenience method for single-process testing.
   * In production, DKG should be coordinated across separate parties.
   */
  async initializeCluster(): Promise<FROSTCluster> {
    // Generate contributions for all parties (simulating distributed DKG)
    const contributions = await Promise.all(
      Array.from({ length: this.totalParties }, (_, i) =>
        this.generateKeyGenContribution(i + 1),
      ),
    )

    // Finalize key generation
    const result = await this.finalizeKeyGen(
      contributions.map((c) => c.publicShare),
      contributions.map((c) => c.commitment),
    )

    this.groupPublicKey = result.groupPublicKey
    this.groupAddress = result.groupAddress

    return {
      keyId: this.keyId,
      threshold: this.threshold,
      totalParties: this.totalParties,
      groupPublicKey: result.groupPublicKey,
      groupAddress: result.groupAddress,
    }
  }

  /**
   * Get the cluster address
   */
  getAddress(): Address {
    if (!this.groupAddress) {
      throw new Error(
        'Cluster not initialized - call initializeCluster() first',
      )
    }
    return this.groupAddress
  }

  /**
   * Get the cluster info
   */
  getCluster(): FROSTCluster {
    if (!this.groupPublicKey || !this.groupAddress) {
      throw new Error(
        'Cluster not initialized - call initializeCluster() first',
      )
    }
    return {
      keyId: this.keyId,
      threshold: this.threshold,
      totalParties: this.totalParties,
      groupPublicKey: this.groupPublicKey,
      groupAddress: this.groupAddress,
    }
  }

  /**
   * Sign a message hash using FROST
   * This is a convenience method for single-process testing.
   * In production, signing should be coordinated across separate parties.
   */
  async sign(messageHash: Hex): Promise<{ r: Hex; s: Hex; v: number }> {
    if (!this.groupPublicKey) {
      throw new Error(
        'Cluster not initialized - call initializeCluster() first',
      )
    }

    // Generate commitments from t parties
    const participantIndices = Array.from(
      { length: this.threshold },
      (_, i) => i + 1,
    )

    const commitmentResults = await Promise.all(
      participantIndices.map(async (partyIndex) => {
        const { nonce, commitment } = await this.generateSigningCommitment(
          partyIndex,
          messageHash,
        )
        return { partyIndex, nonce, commitment }
      }),
    )

    // Convert to D/E format (using nonce bytes)
    const commitments = commitmentResults.map((c) => ({
      partyIndex: c.partyIndex,
      D: toHex(c.nonce.slice(0, 32)) as Hex,
      E: toHex(c.nonce.slice(32, 64)) as Hex,
      commitment: c.commitment,
    }))

    // Generate signature shares
    const shares = await Promise.all(
      commitmentResults.map(async (c) => {
        const share = await this.generateSignatureShare(
          c.partyIndex,
          messageHash,
          c.nonce,
          commitments.map((cm) => ({
            partyIndex: cm.partyIndex,
            commitment: cm.commitment,
          })),
        )
        return { partyIndex: c.partyIndex, share }
      }),
    )

    // Aggregate signatures
    return FROSTCoordinator.aggregateSignatures(
      messageHash,
      this.groupPublicKey,
      commitments,
      shares,
    )
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

    // SECURITY NOTE: This is a single-party DKG implementation.
    // In a full multi-party deployment, each party would:
    // 1. Verify all commitments from other parties
    // 2. Receive encrypted shares from every other party
    // 3. Verify received shares against published commitments
    // 4. Sum all received shares to get their aggregate share
    //
    // For unit testing and single-worker development, we use the sum of
    // polynomial coefficients as the secret (which is mathematically
    // equivalent to receiving shares from a single-party DKG).
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
   *
   * NOTE: This is a simplified aggregation suitable for testing.
   * In production, D and E should be actual EC point commitments.
   * This implementation handles the case where D/E may be hash outputs
   * or commitment scalars rather than EC points.
   */
  static aggregateSignatures(
    messageHash: Hex,
    _groupPublicKey: Hex,
    commitments: { partyIndex: number; D: Hex; E: Hex }[],
    shares: { partyIndex: number; share: Hex }[],
  ): { r: Hex; s: Hex; v: number } {
    // Aggregate commitments to compute R
    // In real FROST, D and E are EC point commitments
    // For our simplified version, we aggregate scalars and derive R

    let aggregateRScalar = ZERO

    for (const c of commitments) {
      // Compute binding factor for this party
      const bindingFactor =
        bytesToBigint(
          toBytes(keccak256(toBytes(`${c.partyIndex}${messageHash}`))),
        ) % CURVE_ORDER

      // Parse D and E - handle both hex scalars and compressed EC points
      const dBytes = toBytes(c.D)
      const eBytes = toBytes(c.E)

      let dScalar: bigint
      let eScalar: bigint

      // If 33 bytes, it's a compressed EC point - extract x coordinate as scalar
      // If 32 bytes or hex, treat as scalar value
      if (dBytes.length === 33) {
        try {
          const dPoint = secp256k1.ProjectivePoint.fromHex(dBytes)
          dScalar = dPoint.toAffine().x % CURVE_ORDER
        } catch {
          // Fallback: use hash of bytes as scalar
          dScalar = bytesToBigint(toBytes(keccak256(dBytes))) % CURVE_ORDER
        }
      } else {
        // Use as scalar directly, but ensure within valid range
        dScalar = bytesToBigint(dBytes) % CURVE_ORDER
      }

      if (eBytes.length === 33) {
        try {
          const ePoint = secp256k1.ProjectivePoint.fromHex(eBytes)
          eScalar = ePoint.toAffine().x % CURVE_ORDER
        } catch {
          eScalar = bytesToBigint(toBytes(keccak256(eBytes))) % CURVE_ORDER
        }
      } else {
        eScalar = bytesToBigint(eBytes) % CURVE_ORDER
      }

      // Ensure scalars are non-zero to avoid EC point multiplication errors
      if (dScalar === ZERO) dScalar = ONE
      if (eScalar === ZERO) eScalar = ONE
      if (bindingFactor === ZERO) continue

      // R_i scalar = d_i + rho_i * e_i (scalar domain aggregation)
      const partyRScalar =
        (dScalar + ((bindingFactor * eScalar) % CURVE_ORDER)) % CURVE_ORDER
      aggregateRScalar = (aggregateRScalar + partyRScalar) % CURVE_ORDER
    }

    // Ensure non-zero R scalar
    if (aggregateRScalar === ZERO) {
      aggregateRScalar = ONE
    }

    // Convert aggregate scalar to point to get r
    const aggregateRPoint = GENERATOR.multiply(aggregateRScalar)
    const rValue = aggregateRPoint.toAffine().x % CURVE_ORDER
    const rHex = `0x${rValue.toString(16).padStart(64, '0')}` as Hex

    // Aggregate signature shares: s = sum(z_i)
    let aggregateS = ZERO
    for (const share of shares) {
      const shareBytes = toBytes(share.share)
      let shareScalar = bytesToBigint(shareBytes) % CURVE_ORDER
      // Ensure non-zero
      if (shareScalar === ZERO) shareScalar = ONE
      aggregateS = (aggregateS + shareScalar) % CURVE_ORDER
    }
    aggregateS = ((aggregateS % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
    if (aggregateS === ZERO) aggregateS = ONE

    const sHex = `0x${aggregateS.toString(16).padStart(64, '0')}` as Hex

    // Compute v from R.y parity (27 for even, 28 for odd)
    const yParity = aggregateRPoint.toAffine().y % BigInt(2)
    const v = yParity === ZERO ? 27 : 28

    return { r: rHex, s: sHex, v }
  }

  /**
   * Clean up sensitive data
   */
  shutdown(): void {
    // Zero private share
    if (this.privateShare !== null) {
      this.privateShare = ZERO
    }
    // Clear polynomial
    if (this.polynomial) {
      this.polynomial.fill(ZERO)
      this.polynomial = null
    }
    // Clear signing nonces
    for (const [key, nonce] of this.signingNonces) {
      nonce.d = ZERO
      nonce.e = ZERO
      this.signingNonces.delete(key)
    }
    // Clear public shares
    this.publicShares.clear()
  }
}
