/**
 * MPC Coordinator - Shamir's Secret Sharing for t-of-n key management
 */

import { type Hex, keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  getMPCConfig,
  type KeyRotationParams,
  type KeyRotationResult,
  type KeyShareMetadata,
  type KeyVersion,
  MAX_MPC_SESSIONS,
  type MPCCoordinatorConfig,
  type MPCKeyGenParams,
  type MPCKeyGenResult,
  type MPCParty,
  type MPCSignatureResult,
  type MPCSignRequest,
  type MPCSignSession,
  type PartialSignature,
} from './types.js'

const CURVE_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
)

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base = ((base % mod) + mod) % mod
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod
    exp = exp >> 1n
    base = (base * base) % mod
  }
  return result
}

function modInverse(a: bigint, mod: bigint): bigint {
  return modPow(a, mod - 2n, mod)
}

function evaluatePolynomial(coefficients: bigint[], x: bigint): bigint {
  let result = 0n
  for (let i = coefficients.length - 1; i >= 0; i--) {
    result =
      (((result * x + coefficients[i]) % CURVE_ORDER) + CURVE_ORDER) %
      CURVE_ORDER
  }
  return result
}

function lagrangeCoefficient(indices: number[], targetIndex: number): bigint {
  let num = 1n
  let den = 1n
  const xi = BigInt(targetIndex)

  for (const j of indices) {
    if (j !== targetIndex) {
      const xj = BigInt(j)
      num = (((num * -xj) % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
      den = (((den * (xi - xj)) % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
    }
  }

  return (num * modInverse(den, CURVE_ORDER)) % CURVE_ORDER
}

function generatePolynomial(secret: bigint, degree: number): bigint[] {
  const coefficients: bigint[] = [secret]
  for (let i = 1; i <= degree; i++) {
    const randomBytes = crypto.getRandomValues(new Uint8Array(32))
    let coeff = 0n
    for (let j = 0; j < 32; j++) coeff = (coeff << 8n) | BigInt(randomBytes[j])
    coefficients.push(coeff % CURVE_ORDER)
  }
  return coefficients
}

function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0')
  return toBytes(`0x${hex}` as Hex)
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let result = 0n
  for (const byte of bytes) result = (result << 8n) | BigInt(byte)
  return result
}

export class MPCCoordinator {
  private config: MPCCoordinatorConfig
  private parties = new Map<string, MPCParty>()
  private keys = new Map<string, MPCKeyGenResult>()
  private keyVersions = new Map<string, KeyVersion[]>()
  private sessions = new Map<string, MPCSignSession>()
  private partySecrets = new Map<string, Map<string, bigint>>()

  constructor(config: Partial<MPCCoordinatorConfig> = {}) {
    this.config = { ...getMPCConfig('localnet'), ...config }
  }

  registerParty(party: Omit<MPCParty, 'status' | 'lastSeen'>): MPCParty {
    if (this.config.requireAttestation) {
      if (!party.attestation) throw new Error('Party attestation is required')
      if (!party.attestation.verified)
        throw new Error('Party attestation is not verified')
    }
    if (party.stake < this.config.minPartyStake) {
      throw new Error(
        `Insufficient stake: ${party.stake} < ${this.config.minPartyStake}`,
      )
    }

    const fullParty: MPCParty = {
      ...party,
      status: 'active',
      lastSeen: Date.now(),
    }
    this.parties.set(party.id, fullParty)
    return fullParty
  }

  getActiveParties(): MPCParty[] {
    const staleThreshold = 5 * 60 * 1000
    return Array.from(this.parties.values()).filter(
      (p) => p.status === 'active' && Date.now() - p.lastSeen < staleThreshold,
    )
  }

  partyHeartbeat(partyId: string): void {
    const party = this.parties.get(partyId)
    if (party) party.lastSeen = Date.now()
  }

  async generateKey(params: MPCKeyGenParams): Promise<MPCKeyGenResult> {
    const { keyId, threshold, totalParties, partyIds } = params

    if (threshold < 2) throw new Error('Threshold must be at least 2')
    if (threshold > totalParties)
      throw new Error('Threshold cannot exceed total parties')
    if (partyIds.length !== totalParties)
      throw new Error('Party count mismatch')
    if (this.keys.has(keyId)) throw new Error(`Key ${keyId} already exists`)

    for (const partyId of partyIds) {
      const party = this.parties.get(partyId)
      if (!party || party.status !== 'active')
        throw new Error(`Party ${partyId} not active`)
    }

    // Each party generates random polynomial and shares
    const partyPolynomials = new Map<string, bigint[]>()
    const partyCommitments = new Map<string, Hex[]>()

    for (const partyId of partyIds) {
      const secretContribution =
        bytesToBigint(crypto.getRandomValues(new Uint8Array(32))) % CURVE_ORDER
      const polynomial = generatePolynomial(secretContribution, threshold - 1)
      partyPolynomials.set(partyId, polynomial)
      partyCommitments.set(
        partyId,
        polynomial.map((coeff) => keccak256(bigintToBytes32(coeff))),
      )
    }

    // Compute shares for each party
    const partyShares = new Map<string, KeyShareMetadata>()
    const keySecrets = new Map<string, bigint>()

    for (let i = 0; i < partyIds.length; i++) {
      const receiverId = partyIds[i]
      const receiverIndex = i + 1
      let aggregatedShare = 0n

      for (const polynomial of partyPolynomials.values()) {
        aggregatedShare =
          (aggregatedShare +
            evaluatePolynomial(polynomial, BigInt(receiverIndex))) %
          CURVE_ORDER
      }

      keySecrets.set(receiverId, aggregatedShare)
      const shareBytes = bigintToBytes32(aggregatedShare)
      partyShares.set(receiverId, {
        partyId: receiverId,
        commitment: keccak256(shareBytes),
        publicShare: keccak256(toBytes(`${receiverId}:${receiverIndex}`)),
        createdAt: Date.now(),
        version: 1,
      })
    }

    // Compute aggregate public key
    let aggregateSecret = 0n
    for (const polynomial of partyPolynomials.values()) {
      aggregateSecret = (aggregateSecret + polynomial[0]) % CURVE_ORDER
    }

    const privateKeyHex =
      `0x${aggregateSecret.toString(16).padStart(64, '0')}` as `0x${string}`
    const account = privateKeyToAccount(privateKeyHex)

    const result: MPCKeyGenResult = {
      keyId,
      publicKey: toHex(account.publicKey),
      address: account.address,
      threshold,
      totalParties,
      partyShares,
      version: 1,
      createdAt: Date.now(),
    }

    this.keys.set(keyId, result)
    this.partySecrets.set(keyId, keySecrets)
    this.keyVersions.set(keyId, [
      {
        version: 1,
        publicKey: result.publicKey,
        address: result.address,
        threshold,
        totalParties,
        partyIds,
        createdAt: Date.now(),
        status: 'active',
      },
    ])

    for (const polynomial of partyPolynomials.values()) polynomial.fill(0n)
    return result
  }

  getKey(keyId: string): MPCKeyGenResult | undefined {
    return this.keys.get(keyId)
  }

  getKeyVersions(keyId: string): KeyVersion[] {
    const versions = this.keyVersions.get(keyId)
    if (!versions) throw new Error(`Key versions not found for ${keyId}`)
    return versions
  }

  async requestSignature(request: MPCSignRequest): Promise<MPCSignSession> {
    const key = this.keys.get(request.keyId)
    if (!key) throw new Error(`Key ${request.keyId} not found`)

    // Force cleanup if sessions exceed maximum to prevent DoS
    if (this.sessions.size >= MAX_MPC_SESSIONS) {
      this.cleanupExpiredSessions()
      // If still at max after cleanup, reject
      if (this.sessions.size >= MAX_MPC_SESSIONS) {
        throw new Error('Session storage limit reached')
      }
    }

    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status === 'pending' || s.status === 'signing',
    )
    if (activeSessions.length >= this.config.maxConcurrentSessions) {
      throw new Error('Maximum concurrent sessions reached')
    }

    const session: MPCSignSession = {
      sessionId: crypto.randomUUID(),
      keyId: request.keyId,
      messageHash: request.messageHash,
      requester: request.requester,
      participants: Array.from(key.partyShares.keys()).slice(0, key.threshold),
      threshold: key.threshold,
      round: 'commitment',
      commitments: new Map(),
      reveals: new Map(),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.sessionTimeout,
      status: 'pending',
    }

    this.sessions.set(session.sessionId, session)
    return session
  }

  async submitPartialSignature(
    sessionId: string,
    partyId: string,
    partial: PartialSignature,
  ): Promise<{ complete: boolean; signature?: MPCSignatureResult }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (session.status === 'complete')
      throw new Error('Session already complete')
    if (session.status === 'expired') throw new Error('Session expired')
    if (Date.now() > session.expiresAt) {
      session.status = 'expired'
      throw new Error('Session expired')
    }
    if (!session.participants.includes(partyId))
      throw new Error(`Party ${partyId} not in session`)

    const expectedCommitment = keccak256(
      toBytes(`${partial.partialR}:${partial.partialS}`),
    )
    if (
      session.round === 'reveal' &&
      session.commitments.get(partyId) !== expectedCommitment
    ) {
      throw new Error('Commitment mismatch')
    }

    if (session.round === 'commitment') {
      session.commitments.set(partyId, partial.commitment)
      if (session.commitments.size >= session.threshold)
        session.round = 'reveal'
      session.status = 'signing'
    } else {
      session.reveals.set(partyId, partial)
    }

    if (session.reveals.size >= session.threshold) {
      const signature = await this.aggregateSignature(session)
      session.status = 'complete'
      return { complete: true, signature }
    }

    return { complete: false }
  }

  private async aggregateSignature(
    session: MPCSignSession,
  ): Promise<MPCSignatureResult> {
    const key = this.keys.get(session.keyId)
    if (!key) throw new Error(`Key ${session.keyId} not found`)

    const keySecrets = this.partySecrets.get(session.keyId)
    if (!keySecrets)
      throw new Error(`Key secrets not found for ${session.keyId}`)

    const participantIndices = session.participants.map((partyId) => {
      return Array.from(key.partyShares.keys()).indexOf(partyId) + 1
    })

    let reconstructedKey = 0n
    for (let i = 0; i < session.participants.length; i++) {
      const share = keySecrets.get(session.participants[i])
      if (!share)
        throw new Error(`Share not found for party ${session.participants[i]}`)

      const lambda = lagrangeCoefficient(
        participantIndices,
        participantIndices[i],
      )
      reconstructedKey = (reconstructedKey + share * lambda) % CURVE_ORDER
    }
    reconstructedKey =
      ((reconstructedKey % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER

    const privateKeyHex =
      `0x${reconstructedKey.toString(16).padStart(64, '0')}` as `0x${string}`
    const account = privateKeyToAccount(privateKeyHex)

    if (account.address !== key.address) {
      throw new Error('Reconstructed key address mismatch')
    }

    const signature = await account.signMessage({
      message: { raw: toBytes(session.messageHash) },
    })

    // Zero reconstructed key after use (bigint is immutable, reassign helps GC)
    reconstructedKey = 0n

    return {
      signature,
      r: signature.slice(0, 66) as Hex,
      s: `0x${signature.slice(66, 130)}` as Hex,
      v: parseInt(signature.slice(130, 132), 16),
      keyId: session.keyId,
      sessionId: session.sessionId,
      participants: session.participants,
      signedAt: Date.now(),
    }
  }

  async rotateKey(params: KeyRotationParams): Promise<KeyRotationResult> {
    const { keyId, newThreshold, newParties } = params
    const key = this.keys.get(keyId)
    if (!key) throw new Error(`Key ${keyId} not found`)

    const keySecrets = this.partySecrets.get(keyId)
    if (!keySecrets) throw new Error(`Key secrets not found for ${keyId}`)

    const versions = this.keyVersions.get(keyId)
    if (!versions) throw new Error(`Key versions not found for ${keyId}`)

    // newThreshold and newParties are optional rotation parameters - use current values if not provided
    const threshold = newThreshold !== undefined ? newThreshold : key.threshold
    const partyIds =
      newParties !== undefined ? newParties : Array.from(key.partyShares.keys())

    if (threshold < 2) throw new Error('Threshold must be at least 2')
    if (threshold > partyIds.length)
      throw new Error('Threshold cannot exceed party count')

    const currentPartyIds = Array.from(key.partyShares.keys())
    const currentIndices = currentPartyIds.map((_, i) => i + 1)

    let secret = 0n
    for (let i = 0; i < key.threshold; i++) {
      const share = keySecrets.get(currentPartyIds[i])
      if (!share)
        throw new Error(`Share not found for party ${currentPartyIds[i]}`)
      const lambda = lagrangeCoefficient(
        currentIndices.slice(0, key.threshold),
        currentIndices[i],
      )
      secret = (secret + share * lambda) % CURVE_ORDER
    }
    secret = ((secret % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER

    const newPolynomial = generatePolynomial(secret, threshold - 1)
    const newShares = new Map<string, bigint>()
    const newShareMetadata = new Map<string, KeyShareMetadata>()
    const newVersion = key.version + 1

    for (let i = 0; i < partyIds.length; i++) {
      const partyId = partyIds[i]
      const share = evaluatePolynomial(newPolynomial, BigInt(i + 1))
      newShares.set(partyId, share)

      newShareMetadata.set(partyId, {
        partyId,
        commitment: keccak256(bigintToBytes32(share)),
        publicShare: keccak256(toBytes(`${partyId}:${i + 1}:${newVersion}`)),
        createdAt: Date.now(),
        version: newVersion,
      })
    }

    const currentVersion = versions.find((v) => v.status === 'active')
    if (currentVersion) {
      currentVersion.status = 'rotated'
      currentVersion.rotatedAt = Date.now()
    }

    versions.push({
      version: newVersion,
      publicKey: key.publicKey,
      address: key.address,
      threshold,
      totalParties: partyIds.length,
      partyIds,
      createdAt: Date.now(),
      status: 'active',
    })

    key.threshold = threshold
    key.totalParties = partyIds.length
    key.partyShares = newShareMetadata
    key.version = newVersion
    this.partySecrets.set(keyId, newShares)

    secret = 0n
    newPolynomial.fill(0n)

    return {
      keyId,
      oldVersion: newVersion - 1,
      newVersion,
      publicKey: key.publicKey,
      address: key.address,
      partyShares: newShareMetadata,
      rotatedAt: Date.now(),
    }
  }

  revokeKey(keyId: string): void {
    const key = this.keys.get(keyId)
    if (!key) throw new Error(`Key ${keyId} not found`)

    const versions = this.keyVersions.get(keyId)
    if (versions) {
      for (const version of versions) version.status = 'revoked'
    }

    // Securely zero all party secrets before deletion
    const secrets = this.partySecrets.get(keyId)
    if (secrets) {
      // Zero each secret value by overwriting with 0n before clearing
      for (const partyId of secrets.keys()) {
        secrets.set(partyId, 0n)
      }
      secrets.clear()
    }
    this.partySecrets.delete(keyId)
    this.keys.delete(keyId)
  }

  getSession(sessionId: string): MPCSignSession | undefined {
    return this.sessions.get(sessionId)
  }

  cleanupExpiredSessions(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [sessionId, session] of this.sessions) {
      if (now > session.expiresAt && session.status !== 'complete') {
        session.status = 'expired'
        this.sessions.delete(sessionId)
        cleaned++
      }
    }

    return cleaned
  }

  getStatus(): {
    activeParties: number
    totalKeys: number
    activeSessions: number
    config: MPCCoordinatorConfig
  } {
    return {
      activeParties: this.getActiveParties().length,
      totalKeys: this.keys.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        (s) => s.status === 'pending' || s.status === 'signing',
      ).length,
      config: this.config,
    }
  }
}

let globalCoordinator: MPCCoordinator | undefined

export function getMPCCoordinator(
  config?: Partial<MPCCoordinatorConfig>,
): MPCCoordinator {
  if (!globalCoordinator) {
    const network = (process.env.MPC_NETWORK ??
      'localnet') as MPCCoordinatorConfig['network']
    globalCoordinator = new MPCCoordinator({
      ...getMPCConfig(network),
      ...config,
    })
  }
  return globalCoordinator
}

export function resetMPCCoordinator(): void {
  globalCoordinator = undefined
}
