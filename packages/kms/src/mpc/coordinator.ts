/**
 * MPC Coordinator - Shamir's Secret Sharing for t-of-n key management
 *
 * ⚠️ SECURITY WARNING ⚠️
 *
 * This coordinator reconstructs the full private key during signing.
 * For production use, prefer the SecureSigningService from signing-service.ts
 * or FROSTCoordinator from frost-signing.ts which NEVER reconstructs keys.
 */

import { getEnv, getEnvOrDefault, logger } from '@jejunetwork/shared'
import { type Hex, keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { SecureShare, SecureShareMap } from './secure-share.js'
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

/**
 * ⚠️ SECURITY WARNING: This coordinator stores ALL party secrets in memory.
 *
 * For production deployments:
 * - Use SecureSigningService (signing-service.ts) which enforces distributed parties
 * - Or deploy FROST parties on SEPARATE physical hardware
 * - Set MPC_ACKNOWLEDGE_CENTRALIZED_RISK=true only if you understand the risks
 */
export class MPCCoordinator {
  private config: MPCCoordinatorConfig
  private parties = new Map<string, MPCParty>()
  private keys = new Map<string, MPCKeyGenResult>()
  private keyVersions = new Map<string, KeyVersion[]>()
  private sessions = new Map<string, MPCSignSession>()
  /**
   * ⚠️ All party secrets stored here - defeats MPC in side-channel attack
   * Each party should hold ONLY their own secret on separate hardware.
   *
   * IMPROVEMENT: Now using SecureShareMap for zeroable storage.
   * Shares can be securely zeroed when keys are deleted or rotated.
   */
  private partySecrets = new Map<string, SecureShareMap>()

  constructor(config: Partial<MPCCoordinatorConfig> = {}) {
    this.config = { ...getMPCConfig('localnet'), ...config }

    // Production safety: BLOCK insecure centralized coordinator on mainnet
    const network = config.network ?? 'localnet'
    if (network === 'mainnet') {
      const acknowledged = getEnv('MPC_ACKNOWLEDGE_CENTRALIZED_RISK') === 'true'
      if (!acknowledged) {
        throw new Error(
          'SECURITY BLOCK: MPCCoordinator cannot be used on mainnet.\n' +
            'This coordinator stores ALL party secrets in memory, defeating MPC security.\n' +
            'A TEE side-channel attack would expose the complete private key.\n\n' +
            'For production, use:\n' +
            '  - SecureSigningService from signing-service.ts (recommended)\n' +
            '  - Deploy FROST parties on SEPARATE physical TEE hardware\n\n' +
            'To bypass (NOT RECOMMENDED): Set MPC_ACKNOWLEDGE_CENTRALIZED_RISK=true',
        )
      }
      logger.warn('MPCCoordinator used on mainnet with acknowledged risk')
    } else if (network === 'testnet') {
      const acknowledged = getEnv('MPC_ACKNOWLEDGE_CENTRALIZED_RISK') === 'true'
      if (!acknowledged) {
        logger.warn(
          'MPCCoordinator stores all secrets in memory - defeats MPC security. ' +
            'For production, use SecureSigningService or distributed FROST parties.',
        )
      }
    }
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

    // Compute shares for each party using SecureShareMap (zeroable storage)
    const partyShares = new Map<string, KeyShareMetadata>()
    const keySecrets = new SecureShareMap()

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

      // Convert to SecureShare for zeroable storage
      keySecrets.set(receiverId, SecureShare.fromBigInt(aggregatedShare))
      const shareBytes = bigintToBytes32(aggregatedShare)
      // Zero the aggregatedShare (though bigint reference will be GC'd)
      aggregatedShare = 0n

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
    // Zero after use
    aggregateSecret = 0n

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

  /**
   * Aggregate partial signatures into final signature.
   *
   * ⚠️ SECURITY WARNING - SIDE CHANNEL VULNERABILITY ⚠️
   *
   * This implementation reconstructs the FULL PRIVATE KEY in memory during
   * signing. It is INSECURE against TEE side-channel attacks (Spectre,
   * Meltdown, cache-timing, etc.) because:
   *
   * 1. The full private key exists in memory during signing
   * 2. JavaScript bigint is immutable - "zeroing" only clears the reference
   * 3. All party secrets are stored in a single Map (defeats MPC purpose)
   *
   * FOR PRODUCTION USE:
   * - Use the FROST implementation in frost-signing.ts which provides TRUE
   *   threshold signing where the private key is NEVER reconstructed
   * - Deploy parties on SEPARATE PHYSICAL HARDWARE in different locations
   * - Use the DWS MPC architecture (dws-worker/mpc-discovery.ts)
   *
   * This coordinator is suitable ONLY for:
   * - Development and testing
   * - Scenarios where single-TEE security is acceptable
   *
   * NOTE: Use FROST-based distributed signing for production
   */
  private async aggregateSignature(
    session: MPCSignSession,
  ): Promise<MPCSignatureResult> {
    // SECURITY: Log warning about key reconstruction
    logger.warn(
      'MPCCoordinator.aggregateSignature reconstructs the full private key in memory. ' +
        'This is INSECURE for production TEE deployments. ' +
        'Use SecureSigningService or FROSTCoordinator instead.',
      { keyId: session.keyId, sessionId: session.sessionId },
    )

    const key = this.keys.get(session.keyId)
    if (!key) throw new Error(`Key ${session.keyId} not found`)

    const keySecrets = this.partySecrets.get(session.keyId)
    if (!keySecrets)
      throw new Error(`Key secrets not found for ${session.keyId}`)

    const participantIndices = session.participants.map((partyId) => {
      return Array.from(key.partyShares.keys()).indexOf(partyId) + 1
    })

    // Reconstruct key using Lagrange interpolation
    // NOTE: This temporarily reconstructs the full private key
    // We use SecureShare to zero the intermediate values after use
    let reconstructedKey = 0n
    for (let i = 0; i < session.participants.length; i++) {
      const secureShare = keySecrets.get(session.participants[i])
      if (!secureShare)
        throw new Error(`Share not found for party ${session.participants[i]}`)

      // Get the share value (temporarily as bigint for arithmetic)
      const share = secureShare.toBigInt()
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

    // SECURITY: Clear the reconstructed key reference after use.
    // bigint is immutable, but clearing the reference helps with GC.
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

  /**
   * Rotate key shares using proactive secret sharing.
   *
   * SECURITY: This uses proactive secret sharing where each party generates
   * a new random polynomial with zero as the secret, shares it with other
   * parties, and everyone adds their received shares to their existing share.
   * This changes all shares without changing the underlying secret or requiring
   * the secret to be reconstructed.
   *
   * This is side-channel resistant: the secret is never reconstructed during rotation.
   */
  async rotateKey(params: KeyRotationParams): Promise<KeyRotationResult> {
    const { keyId, newThreshold, newParties } = params
    const key = this.keys.get(keyId)
    if (!key) throw new Error(`Key ${keyId} not found`)

    const keySecrets = this.partySecrets.get(keyId)
    if (!keySecrets) throw new Error(`Key secrets not found for ${keyId}`)

    const versions = this.keyVersions.get(keyId)
    if (!versions) throw new Error(`Key versions not found for ${keyId}`)

    const threshold = newThreshold !== undefined ? newThreshold : key.threshold
    const partyIds =
      newParties !== undefined ? newParties : Array.from(key.partyShares.keys())

    if (threshold < 2) throw new Error('Threshold must be at least 2')
    if (threshold > partyIds.length)
      throw new Error('Threshold cannot exceed party count')

    const newVersion = key.version + 1

    // PROACTIVE SECRET SHARING: Each party generates a random polynomial
    // with constant term = 0 (zero-sharing). When all parties add their
    // received zero-shares to their existing share, the secret stays the
    // same but all shares change.
    const zeroSharePolynomials = new Map<string, bigint[]>()
    for (const partyId of partyIds) {
      // Generate polynomial with f(0) = 0 (zero as constant term)
      const zeroPolynomial = generatePolynomial(0n, threshold - 1)
      zeroPolynomial[0] = 0n // Ensure constant term is zero
      zeroSharePolynomials.set(partyId, zeroPolynomial)
    }

    // Each party computes new shares by adding zero-shares from all parties
    // Using SecureShareMap for zeroable storage
    const newShares = new SecureShareMap()
    const newShareMetadata = new Map<string, KeyShareMetadata>()

    for (let i = 0; i < partyIds.length; i++) {
      const receiverId = partyIds[i]
      const receiverIndex = i + 1

      // Start with old share (or 0 if new party)
      const oldSecureShare = keySecrets.get(receiverId)
      let newShare = oldSecureShare ? oldSecureShare.toBigInt() : 0n

      // Add zero-shares from each party's polynomial evaluated at receiver's index
      for (const polynomial of zeroSharePolynomials.values()) {
        newShare =
          (newShare + evaluatePolynomial(polynomial, BigInt(receiverIndex))) %
          CURVE_ORDER
      }
      newShare = ((newShare % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER

      // Convert to SecureShare for zeroable storage
      const newSecureShare = SecureShare.fromBigInt(newShare)
      newShares.set(receiverId, newSecureShare)
      newShareMetadata.set(receiverId, {
        partyId: receiverId,
        commitment: keccak256(bigintToBytes32(newShare)),
        publicShare: keccak256(
          toBytes(`${receiverId}:${receiverIndex}:${newVersion}`),
        ),
        createdAt: Date.now(),
        version: newVersion,
      })
      // Clear temporary bigint reference
      newShare = 0n
    }

    // Zero out the temporary polynomials
    for (const polynomial of zeroSharePolynomials.values()) {
      polynomial.fill(0n)
    }
    zeroSharePolynomials.clear()

    // Securely zero the old shares before replacing
    keySecrets.clear()

    // Update version tracking
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

    // Update key state
    key.threshold = threshold
    key.totalParties = partyIds.length
    key.partyShares = newShareMetadata
    key.version = newVersion
    this.partySecrets.set(keyId, newShares)

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
      // SecureShareMap.clear() securely zeros all shares
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

function isValidNetwork(
  value: string,
): value is MPCCoordinatorConfig['network'] {
  return value === 'localnet' || value === 'testnet' || value === 'mainnet'
}

export function getMPCCoordinator(
  config?: Partial<MPCCoordinatorConfig>,
): MPCCoordinator {
  if (!globalCoordinator) {
    const networkEnv = getEnvOrDefault('MPC_NETWORK', 'localnet')
    const network = isValidNetwork(networkEnv) ? networkEnv : 'localnet'
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
