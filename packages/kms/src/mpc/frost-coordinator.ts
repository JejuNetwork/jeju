/**
 * FROST Coordinator - True Threshold ECDSA
 *
 * Integrates with @jejunetwork/oauth3 FROST implementation for true threshold
 * signing where the private key is NEVER reconstructed.
 *
 * This is a wrapper around the OAuth3 FROST implementation that provides
 * the same interface as the existing MPCCoordinator.
 */

import { type Hex, keccak256, toBytes } from 'viem'
import {
  getMPCConfig,
  type KeyVersion,
  type MPCCoordinatorConfig,
  type MPCKeyGenParams,
  type MPCKeyGenResult,
  type MPCParty,
  type MPCSignatureResult,
  type MPCSignRequest,
  type MPCSignSession,
} from './types.js'

// Dynamic import types for oauth3 FROST
type FROSTCoordinatorType = {
  new (
    keyId: string,
    threshold: number,
    totalParties: number,
  ): FROSTCoordinatorInstance
}

interface FROSTCoordinatorInstance {
  initializeCluster(): Promise<void>
  getCluster(): {
    groupPublicKey: Hex
    threshold: number
    totalParties: number
    parties: Array<{ index: number; publicKey: Hex }>
  }
  getAddress(): `0x${string}`
  sign(
    messageHash: Hex,
    participantIndices: number[],
  ): Promise<{ r: Hex; s: Hex; v: number }>
}

/** Type guard for FROSTCoordinator constructor from dynamic import */
function isFROSTCoordinatorType(value: {
  FROSTCoordinator?: { new (...args: [string, number, number]): object }
}): value is { FROSTCoordinator: FROSTCoordinatorType } {
  return (
    typeof value.FROSTCoordinator === 'function' &&
    value.FROSTCoordinator.length >= 3
  )
}

let FROSTCoordinator: FROSTCoordinatorType | null = null

/** Maximum concurrent signing sessions to prevent resource exhaustion */
const MAX_SESSIONS = 1000

/** Session expiry time in milliseconds (5 minutes) */
const SESSION_EXPIRY_MS = 5 * 60 * 1000

async function loadFROST(): Promise<void> {
  if (!FROSTCoordinator) {
    const oauth3 = await import('@jejunetwork/oauth3')
    if (!isFROSTCoordinatorType(oauth3)) {
      throw new Error(
        'FROSTCoordinator not found or invalid in @jejunetwork/oauth3',
      )
    }
    FROSTCoordinator = oauth3.FROSTCoordinator
  }
}

export class FROSTMPCCoordinator {
  private config: MPCCoordinatorConfig
  private parties = new Map<string, MPCParty>()
  private frostClusters = new Map<string, FROSTCoordinatorInstance>()
  private keyVersions = new Map<string, KeyVersion[]>()
  private sessions = new Map<string, MPCSignSession>()

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
    await loadFROST()
    if (!FROSTCoordinator) throw new Error('FROST not loaded')

    const { keyId, threshold, totalParties, partyIds } = params

    if (threshold < 2) throw new Error('Threshold must be at least 2')
    if (threshold > totalParties)
      throw new Error('Threshold cannot exceed total parties')
    if (partyIds.length !== totalParties)
      throw new Error('Party count mismatch')
    if (this.frostClusters.has(keyId))
      throw new Error(`Key ${keyId} already exists`)

    for (const partyId of partyIds) {
      const party = this.parties.get(partyId)
      if (!party || party.status !== 'active')
        throw new Error(`Party ${partyId} not active`)
    }

    const coordinator = new FROSTCoordinator(keyId, threshold, totalParties)
    await coordinator.initializeCluster()

    this.frostClusters.set(keyId, coordinator)

    const cluster = coordinator.getCluster()
    const address = coordinator.getAddress()

    const version: KeyVersion = {
      version: 1,
      createdAt: Date.now(),
      publicKey: cluster.groupPublicKey,
      address,
      threshold,
      totalParties,
      partyIds,
      status: 'active',
    }

    this.keyVersions.set(keyId, [version])

    const partyShares = new Map<
      string,
      {
        partyId: string
        commitment: Hex
        publicShare: Hex
        createdAt: number
        version: number
      }
    >()
    for (const p of cluster.parties) {
      const partyId = partyIds[p.index - 1]
      partyShares.set(partyId, {
        partyId,
        publicShare: p.publicKey,
        commitment: keccak256(toBytes(`commitment:${keyId}:${p.index}`)),
        createdAt: Date.now(),
        version: 1,
      })
    }

    const result: MPCKeyGenResult = {
      keyId,
      publicKey: cluster.groupPublicKey,
      address,
      threshold,
      totalParties,
      partyShares,
      version: 1,
      createdAt: Date.now(),
    }

    return result
  }

  async initiateSign(request: MPCSignRequest): Promise<MPCSignSession> {
    await loadFROST()

    const { keyId, messageHash, requester } = request

    // Force cleanup if sessions exceed maximum to prevent DoS
    if (this.sessions.size >= MAX_SESSIONS) {
      this.cleanupExpiredSessions()
      if (this.sessions.size >= MAX_SESSIONS) {
        throw new Error('Session storage limit reached')
      }
    }

    const coordinator = this.frostClusters.get(keyId)
    if (!coordinator) throw new Error(`Key ${keyId} not found`)

    const cluster = coordinator.getCluster()
    const versions = this.keyVersions.get(keyId)
    if (!versions || versions.length === 0)
      throw new Error(`No versions found for key ${keyId}`)
    const currentVersion = versions[versions.length - 1]

    const sessionId = keccak256(
      toBytes(`sign:${keyId}:${messageHash}:${Date.now()}`),
    )

    const session: MPCSignSession = {
      sessionId,
      keyId,
      messageHash,
      requester,
      participants: currentVersion.partyIds.slice(0, cluster.threshold),
      threshold: cluster.threshold,
      round: 'commitment',
      commitments: new Map(),
      reveals: new Map(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      status: 'pending',
    }

    this.sessions.set(sessionId, session)

    return session
  }

  async completeSign(sessionId: string): Promise<MPCSignatureResult> {
    await loadFROST()

    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const coordinator = this.frostClusters.get(session.keyId)
    if (!coordinator) {
      throw new Error(`Key ${session.keyId} not found`)
    }

    const cluster = coordinator.getCluster()
    const participantIndices = session.participants
      .slice(0, cluster.threshold)
      .map((_, i) => i + 1)

    const signature = await coordinator.sign(
      session.messageHash,
      participantIndices,
    )

    session.status = 'complete'

    const result: MPCSignatureResult = {
      sessionId,
      keyId: session.keyId,
      signature:
        `0x${signature.r.slice(2)}${signature.s.slice(2)}${signature.v.toString(16).padStart(2, '0')}` as Hex,
      r: signature.r,
      s: signature.s,
      v: signature.v,
      participants: session.participants.slice(0, cluster.threshold),
      signedAt: Date.now(),
    }

    this.sessions.delete(sessionId)

    return result
  }

  async sign(
    keyId: string,
    messageHash: Hex,
    requester: `0x${string}`,
  ): Promise<MPCSignatureResult> {
    const session = await this.initiateSign({
      keyId,
      messageHash,
      requester,
      message: messageHash,
    })
    return this.completeSign(session.sessionId)
  }

  getKey(keyId: string): MPCKeyGenResult | undefined {
    const coordinator = this.frostClusters.get(keyId)
    if (!coordinator) return undefined

    const cluster = coordinator.getCluster()
    const versions = this.keyVersions.get(keyId)
    if (!versions || versions.length === 0)
      throw new Error(`Key versions not found for ${keyId}`)

    return {
      keyId,
      publicKey: cluster.groupPublicKey,
      address: coordinator.getAddress(),
      threshold: cluster.threshold,
      totalParties: cluster.totalParties,
      partyShares: new Map(),
      version: versions.length,
      createdAt: versions[0].createdAt,
    }
  }

  getKeyVersions(keyId: string): KeyVersion[] {
    const versions = this.keyVersions.get(keyId)
    if (!versions) throw new Error(`Key versions not found for ${keyId}`)
    return versions
  }

  getSession(sessionId: string): MPCSignSession | undefined {
    return this.sessions.get(sessionId)
  }

  getStatus(): {
    activeParties: number
    totalKeys: number
    activeSessions: number
    config: MPCCoordinatorConfig
  } {
    return {
      activeParties: this.getActiveParties().length,
      totalKeys: this.frostClusters.size,
      activeSessions: this.sessions.size,
      config: this.config,
    }
  }

  /**
   * Clean up expired sessions to prevent memory exhaustion
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now()
    for (const [sessionId, session] of this.sessions) {
      if (
        now - session.createdAt > SESSION_EXPIRY_MS ||
        session.status === 'complete' ||
        session.status === 'failed'
      ) {
        this.sessions.delete(sessionId)
      }
    }
  }
}

let frostCoordinator: FROSTMPCCoordinator | null = null

export function getFROSTCoordinator(
  config?: Partial<MPCCoordinatorConfig>,
): FROSTMPCCoordinator {
  if (!frostCoordinator) {
    frostCoordinator = new FROSTMPCCoordinator(config)
  }
  return frostCoordinator
}

export function resetFROSTCoordinator(): void {
  frostCoordinator = null
}
