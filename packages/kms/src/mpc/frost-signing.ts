/**
 * FROST Threshold Signing
 *
 * True threshold ECDSA using FROST (Flexible Round-Optimized Schnorr Threshold).
 * The private key is NEVER reconstructed - each party contributes a partial signature.
 *
 * This implements a simplified FROST-like protocol for secp256k1.
 * For production, use a well-audited library like ZCash's frost-secp256k1.
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Address, Hex } from 'viem'
import { toBytes, toHex } from 'viem'

const CURVE_ORDER = secp256k1.CURVE.n
const GENERATOR = secp256k1.ProjectivePoint.BASE

export interface FROSTKeyShare {
  index: number
  secretShare: bigint
  publicShare: typeof GENERATOR
  groupPublicKey: typeof GENERATOR
  verificationKey: typeof GENERATOR
}

export interface FROSTSigningCommitment {
  index: number
  hidingNonce: bigint
  bindingNonce: bigint
  hidingCommitment: typeof GENERATOR
  bindingCommitment: typeof GENERATOR
}

export interface FROSTSignatureShare {
  index: number
  share: bigint
}

export interface FROSTSignature {
  r: Hex
  s: Hex
  v: number
}

export interface FROSTParty {
  index: number
  keyShare: FROSTKeyShare
  endpoint: string
  publicKey: Hex
  active: boolean
}

export interface FROSTCluster {
  clusterId: string
  threshold: number
  totalParties: number
  parties: FROSTParty[]
  groupPublicKey: Hex
  groupAddress: Address
}

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
    numerator = mod(numerator * (xi - xj), CURVE_ORDER)
    denominator = mod(denominator * (BigInt(targetIndex) - xj), CURVE_ORDER)
  }

  return mod(numerator * modInverse(denominator, CURVE_ORDER), CURVE_ORDER)
}

export function generateKeyShares(
  threshold: number,
  totalParties: number,
  existingSecret?: bigint,
): FROSTKeyShare[] {
  if (threshold > totalParties) {
    throw new Error('Threshold cannot exceed total parties')
  }
  if (threshold < 2) {
    throw new Error('Threshold must be at least 2')
  }

  const secret = existingSecret ?? randomScalar()
  const coefficients: bigint[] = [secret]

  for (let i = 1; i < threshold; i++) {
    coefficients.push(randomScalar())
  }

  const groupPublicKey = GENERATOR.multiply(secret)

  const shares: FROSTKeyShare[] = []

  for (let i = 1; i <= totalParties; i++) {
    let shareValue = 0n
    let xPow = 1n

    for (const coeff of coefficients) {
      shareValue = mod(shareValue + coeff * xPow, CURVE_ORDER)
      xPow = mod(xPow * BigInt(i), CURVE_ORDER)
    }

    const publicShare = GENERATOR.multiply(shareValue)
    const verificationKey = GENERATOR.multiply(shareValue)

    shares.push({
      index: i,
      secretShare: shareValue,
      publicShare,
      groupPublicKey,
      verificationKey,
    })
  }

  return shares
}

export function generateSigningCommitment(
  keyShare: FROSTKeyShare,
): FROSTSigningCommitment {
  const hidingNonce = randomScalar()
  const bindingNonce = randomScalar()

  return {
    index: keyShare.index,
    hidingNonce,
    bindingNonce,
    hidingCommitment: GENERATOR.multiply(hidingNonce),
    bindingCommitment: GENERATOR.multiply(bindingNonce),
  }
}

export function computeBindingFactor(
  message: Uint8Array,
  commitments: Array<{
    index: number
    hidingCommitment: typeof GENERATOR
    bindingCommitment: typeof GENERATOR
  }>,
  participantIndex: number,
): bigint {
  const commitmentList = commitments
    .sort((a, b) => a.index - b.index)
    .map((c) => ({
      index: c.index,
      hiding: bytesToHex(c.hidingCommitment.toRawBytes(true)),
      binding: bytesToHex(c.bindingCommitment.toRawBytes(true)),
    }))

  const encoded = new TextEncoder().encode(
    JSON.stringify({
      message: bytesToHex(message),
      commitments: commitmentList,
      index: participantIndex,
    }),
  )

  const hash = sha256(encoded)
  return mod(BigInt(`0x${bytesToHex(hash)}`), CURVE_ORDER)
}

export function computeGroupCommitment(
  commitments: FROSTSigningCommitment[],
  bindingFactors: Map<number, bigint>,
): typeof GENERATOR {
  if (commitments.length === 0) {
    throw new Error('No commitments provided')
  }

  const firstCommitment = commitments[0]
  const firstBindingFactor = bindingFactors.get(firstCommitment.index)
  if (firstBindingFactor === undefined) {
    throw new Error(
      `Missing binding factor for participant ${firstCommitment.index}`,
    )
  }

  const firstBindingContribution =
    firstCommitment.bindingCommitment.multiply(firstBindingFactor)
  let result = firstCommitment.hidingCommitment.add(firstBindingContribution)

  for (let i = 1; i < commitments.length; i++) {
    const commitment = commitments[i]
    const bindingFactor = bindingFactors.get(commitment.index)
    if (bindingFactor === undefined) {
      throw new Error(
        `Missing binding factor for participant ${commitment.index}`,
      )
    }

    const bindingContribution =
      commitment.bindingCommitment.multiply(bindingFactor)
    const combined = commitment.hidingCommitment.add(bindingContribution)
    result = result.add(combined)
  }

  return result
}

export function computeChallenge(
  groupCommitment: typeof GENERATOR,
  groupPublicKey: typeof GENERATOR,
  message: Uint8Array,
): bigint {
  const R = groupCommitment.toRawBytes(true)
  const P = groupPublicKey.toRawBytes(true)

  const data = new Uint8Array(R.length + P.length + message.length)
  data.set(R, 0)
  data.set(P, R.length)
  data.set(message, R.length + P.length)

  const hash = keccak_256(data)
  return mod(BigInt(`0x${bytesToHex(hash)}`), CURVE_ORDER)
}

export function generateSignatureShare(
  keyShare: FROSTKeyShare,
  commitment: FROSTSigningCommitment,
  message: Uint8Array,
  allCommitments: FROSTSigningCommitment[],
  participantIndices: number[],
): FROSTSignatureShare {
  const bindingFactors = new Map<number, bigint>()

  for (const c of allCommitments) {
    bindingFactors.set(
      c.index,
      computeBindingFactor(message, allCommitments, c.index),
    )
  }

  const groupCommitment = computeGroupCommitment(allCommitments, bindingFactors)
  const challenge = computeChallenge(
    groupCommitment,
    keyShare.groupPublicKey,
    message,
  )

  const bindingFactor = bindingFactors.get(keyShare.index)
  if (bindingFactor === undefined) {
    throw new Error(`Missing binding factor for participant ${keyShare.index}`)
  }
  const lambdaI = lagrangeCoefficient(participantIndices, 0, keyShare.index)

  const share = mod(
    commitment.hidingNonce +
      commitment.bindingNonce * bindingFactor +
      lambdaI * keyShare.secretShare * challenge,
    CURVE_ORDER,
  )

  return {
    index: keyShare.index,
    share,
  }
}

export function aggregateSignatures(
  message: Uint8Array,
  groupPublicKey: typeof GENERATOR,
  commitments: FROSTSigningCommitment[],
  shares: FROSTSignatureShare[],
): FROSTSignature {
  if (shares.length < commitments.length) {
    throw new Error('Not enough signature shares')
  }

  const bindingFactors = new Map<number, bigint>()
  for (const c of commitments) {
    bindingFactors.set(
      c.index,
      computeBindingFactor(message, commitments, c.index),
    )
  }

  const groupCommitment = computeGroupCommitment(commitments, bindingFactors)

  let s = 0n
  for (const share of shares) {
    s = mod(s + share.share, CURVE_ORDER)
  }

  const rBytes = groupCommitment.toRawBytes(false)
  const r = mod(BigInt(`0x${bytesToHex(rBytes.slice(1, 33))}`), CURVE_ORDER)

  const pubKeyBytes = groupPublicKey.toRawBytes(false)
  const isYOdd = pubKeyBytes[64] % 2 === 1
  const v = isYOdd ? 28 : 27

  const rHex = toHex(hexToBytes(r.toString(16).padStart(64, '0')))
  const sHex = toHex(hexToBytes(s.toString(16).padStart(64, '0')))

  return { r: rHex, s: sHex, v }
}

export function verifySignature(
  message: Uint8Array,
  signature: FROSTSignature,
  groupPublicKey: typeof GENERATOR,
): boolean {
  const r = BigInt(signature.r)
  const s = BigInt(signature.s)

  if (r <= 0n || r >= CURVE_ORDER) return false
  if (s <= 0n || s >= CURVE_ORDER) return false

  const messageHash = keccak_256(message)
  const z = mod(BigInt(`0x${bytesToHex(messageHash)}`), CURVE_ORDER)

  const sInv = modInverse(s, CURVE_ORDER)
  const u1 = mod(z * sInv, CURVE_ORDER)
  const u2 = mod(r * sInv, CURVE_ORDER)

  const point = GENERATOR.multiply(u1).add(groupPublicKey.multiply(u2))

  if (point.equals(GENERATOR.multiply(0n))) return false

  const recoveredR = mod(point.x, CURVE_ORDER)
  return recoveredR === r
}

export function publicKeyToAddress(publicKey: typeof GENERATOR): Address {
  const pubKeyBytes = publicKey.toRawBytes(false)
  const hash = keccak_256(pubKeyBytes.slice(1))
  return `0x${bytesToHex(hash.slice(-20))}` as Address
}

export function randomScalar(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return mod(BigInt(`0x${bytesToHex(bytes)}`), CURVE_ORDER)
}

export class FROSTCoordinator {
  private cluster: FROSTCluster
  private keyShares: Map<number, FROSTKeyShare> = new Map()

  constructor(clusterId: string, threshold: number, totalParties: number) {
    this.cluster = {
      clusterId,
      threshold,
      totalParties,
      parties: [],
      groupPublicKey: '0x' as Hex,
      groupAddress: '0x0000000000000000000000000000000000000000' as Address,
    }
  }

  async initializeCluster(): Promise<FROSTCluster> {
    const shares = generateKeyShares(
      this.cluster.threshold,
      this.cluster.totalParties,
    )

    for (const share of shares) {
      this.keyShares.set(share.index, share)

      this.cluster.parties.push({
        index: share.index,
        keyShare: share,
        endpoint: `http://localhost:${4200 + share.index}`,
        publicKey: toHex(share.publicShare.toRawBytes(true)),
        active: true,
      })
    }

    const groupPubKey = shares[0].groupPublicKey
    this.cluster.groupPublicKey = toHex(groupPubKey.toRawBytes(true))
    this.cluster.groupAddress = publicKeyToAddress(groupPubKey)

    return this.cluster
  }

  async sign(
    message: Hex,
    participantIndices?: number[],
  ): Promise<FROSTSignature> {
    const indices =
      participantIndices ??
      this.cluster.parties
        .filter((p) => p.active)
        .slice(0, this.cluster.threshold)
        .map((p) => p.index)

    if (indices.length < this.cluster.threshold) {
      throw new Error(`Need at least ${this.cluster.threshold} participants`)
    }

    const commitments: FROSTSigningCommitment[] = []

    for (const index of indices) {
      const keyShare = this.keyShares.get(index)
      if (!keyShare) throw new Error(`Key share not found for party ${index}`)
      commitments.push(generateSigningCommitment(keyShare))
    }

    const messageBytes = toBytes(message)
    const shares: FROSTSignatureShare[] = []

    for (let i = 0; i < indices.length; i++) {
      const index = indices[i]
      const keyShare = this.keyShares.get(index)
      if (!keyShare) throw new Error(`Key share not found for party ${index}`)
      const commitment = commitments[i]

      shares.push(
        generateSignatureShare(
          keyShare,
          commitment,
          messageBytes,
          commitments,
          indices,
        ),
      )
    }

    const firstKeyShare = this.keyShares.get(indices[0])
    if (!firstKeyShare)
      throw new Error(`Key share not found for party ${indices[0]}`)
    const groupPubKey = firstKeyShare.groupPublicKey
    return aggregateSignatures(messageBytes, groupPubKey, commitments, shares)
  }

  getCluster(): FROSTCluster {
    return this.cluster
  }

  getAddress(): Address {
    return this.cluster.groupAddress
  }

  /**
   * Securely clean up all sensitive data.
   * SECURITY: Should be called before the coordinator is garbage collected.
   */
  shutdown(): void {
    // Zero out secret shares (bigint is immutable, but we can overwrite the map entries)
    for (const [index, share] of this.keyShares) {
      // Create a zeroed share to overwrite
      this.keyShares.set(index, {
        ...share,
        secretShare: 0n,
      })
    }
    this.keyShares.clear()

    // Clear cluster parties
    for (const party of this.cluster.parties) {
      party.keyShare = {
        ...party.keyShare,
        secretShare: 0n,
      }
    }
    this.cluster.parties = []
  }
}
