/**
 * MPC Provider - Threshold ECDSA (2-of-3 testnet, 3-of-5 mainnet)
 */

import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem'
import {
  decryptFromPayload,
  deriveKeyFromSecret,
  encryptToPayload,
  generateKeyId,
} from '../crypto.js'
import { mpcLogger as log } from '../logger.js'
import {
  getMPCCoordinator,
  type KeyVersion,
  type MPCCoordinator,
} from '../mpc/index.js'
import { parseEnvInt } from '../schemas.js'
import {
  type AccessControlPolicy,
  type DecryptRequest,
  type EncryptedPayload,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  type KeyMetadata,
  type KeyType,
  type KMSProvider,
  KMSProviderType,
  type MPCConfig,
  type MPCSigningSession,
  type SignedMessage,
  type SignRequest,
  type ThresholdSignature,
  type ThresholdSignRequest,
} from '../types.js'

interface MPCKey {
  metadata: KeyMetadata
  mpcKeyId: string
  address: Address
  publicKey: Hex
  versions: KeyVersion[]
}

/** Safe recovery ID extraction from signature with bounds validation */
function extractRecoveryId(signature: string): number {
  if (signature.length < 132) return 0
  const vHex = signature.slice(130, 132)
  const v = parseInt(vHex, 16)
  // Recovery ID must be 0 or 1 (v is 27/28 for legacy, or 0/1 for EIP-155)
  if (v >= 27 && v <= 28) return v - 27
  if (v === 0 || v === 1) return v
  return 0 // Default to 0 for invalid values
}

export class MPCProvider implements KMSProvider {
  type = KMSProviderType.MPC
  private config: MPCConfig
  private coordinator: MPCCoordinator
  private connected = false
  private keys = new Map<string, MPCKey>()
  private encryptionKey: Uint8Array

  constructor(config: MPCConfig) {
    this.config = config
    this.coordinator = getMPCCoordinator({
      threshold: config.threshold,
      totalParties: config.totalParties,
    })
    const secret =
      process.env.MPC_ENCRYPTION_SECRET ?? process.env.KMS_FALLBACK_SECRET
    if (secret) {
      this.encryptionKey = deriveKeyFromSecret(secret)
    } else {
      this.encryptionKey = crypto.getRandomValues(new Uint8Array(32))
      log.warn(
        'No MPC_ENCRYPTION_SECRET set, using ephemeral key - keys will be lost on restart',
      )
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.config.coordinatorEndpoint) {
      const response = await fetch(
        `${this.config.coordinatorEndpoint}/health`,
        { signal: AbortSignal.timeout(2000) },
      ).catch(() => null)
      return response?.ok
    }
    return true
  }

  async connect(): Promise<void> {
    if (this.connected) return

    const status = this.coordinator.getStatus()
    if (status.activeParties < this.config.totalParties) {
      for (let i = 0; i < this.config.totalParties; i++) {
        const partyKey = crypto.getRandomValues(new Uint8Array(32))
        this.coordinator.registerParty({
          id: `party-${i + 1}`,
          index: i + 1,
          endpoint: `http://localhost:${4100 + i}`,
          publicKey: toHex(partyKey),
          address: `0x${toHex(partyKey).slice(2, 42)}` as Address,
          stake: BigInt(1e18),
          registeredAt: Date.now(),
        })
      }
    }
    this.connected = true
    this.connectPromise = null
  }

  async disconnect(): Promise<void> {
    this.encryptionKey.fill(0)
    this.keys.clear()
    this.connected = false
  }

  async generateKey(
    owner: Address,
    keyType: KeyType,
    curve: KeyCurve,
    policy: AccessControlPolicy,
  ): Promise<GeneratedKey> {
    await this.ensureConnected()

    const keyId = generateKeyId('mpc')
    const partyIds = this.coordinator
      .getActiveParties()
      .slice(0, this.config.totalParties)
      .map((p) => p.id)

    if (partyIds.length < this.config.threshold) {
      throw new Error(
        `Insufficient active parties: ${partyIds.length} < ${this.config.threshold}`,
      )
    }

    const mpcResult = await this.coordinator.generateKey({
      keyId,
      threshold: this.config.threshold,
      totalParties: this.config.totalParties,
      partyIds,
      curve: 'secp256k1',
      accessPolicy: this.policyToAccessPolicy(policy),
    })

    const metadata: KeyMetadata = {
      id: keyId,
      type: keyType,
      curve,
      createdAt: Date.now(),
      owner,
      policy,
      providerType: KMSProviderType.MPC,
    }
    this.keys.set(keyId, {
      metadata,
      mpcKeyId: mpcResult.keyId,
      address: mpcResult.address,
      publicKey: mpcResult.publicKey,
      versions: this.coordinator.getKeyVersions(keyId),
    })

    return { metadata, publicKey: mpcResult.publicKey }
  }

  getKey(keyId: string): KeyMetadata | null {
    return this.keys.get(keyId)?.metadata ?? null
  }

  getKeyVersions(keyId: string): KeyVersion[] {
    const key = this.keys.get(keyId)
    if (!key) throw new Error(`Key ${keyId} not found`)
    return this.coordinator.getKeyVersions(key.mpcKeyId)
  }

  async revokeKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId)
    if (!key) throw new Error(`Key ${keyId} not found`)
    this.coordinator.revokeKey(key.mpcKeyId)
    this.keys.delete(keyId)
  }

  async encrypt(request: EncryptRequest): Promise<EncryptedPayload> {
    await this.ensureConnected()

    const dataStr =
      typeof request.data === 'string'
        ? request.data
        : new TextDecoder().decode(request.data)
    const keyId = request.keyId ?? generateKeyId('mpc-enc')

    const mpcKey = this.keys.get(keyId)
    let version = 1
    if (mpcKey) {
      const coordKey = this.coordinator.getKey(mpcKey.mpcKeyId)
      if (coordKey) version = coordKey.version
    }

    const ciphertext = await encryptToPayload(dataStr, this.encryptionKey, {
      version,
      mpc: true,
    })

    return {
      ciphertext,
      dataHash: keccak256(toBytes(dataStr)),
      accessControlHash: keccak256(toBytes(JSON.stringify(request.policy))),
      policy: request.policy,
      providerType: KMSProviderType.MPC,
      encryptedAt: Math.floor(Date.now() / 1000),
      keyId,
      metadata: {
        ...request.metadata,
        threshold: this.config.threshold.toString(),
        totalParties: this.config.totalParties.toString(),
      },
    }
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureConnected()
    return decryptFromPayload(request.payload.ciphertext, this.encryptionKey)
  }

  async sign(request: SignRequest): Promise<SignedMessage> {
    await this.ensureConnected()

    const key = this.keys.get(request.keyId)
    if (!key) throw new Error(`Key ${request.keyId} not found`)

    const messageBytes =
      typeof request.message === 'string'
        ? toBytes(request.message as Hex)
        : request.message
    const messageHash =
      request.hashAlgorithm === 'none'
        ? toHex(messageBytes)
        : keccak256(messageBytes)

    const session = await this.coordinator.requestSignature({
      keyId: key.mpcKeyId,
      message: toHex(messageBytes),
      messageHash,
      requester: key.metadata.owner,
    })
    const partyIds = this.coordinator
      .getActiveParties()
      .slice(0, this.config.threshold)
      .map((p) => p.id)

    let result: { complete: boolean; signature?: { signature: Hex } } = {
      complete: false,
    }

    for (const partyId of partyIds) {
      const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`))
      const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`))
      result = await this.coordinator.submitPartialSignature(
        session.sessionId,
        partyId,
        {
          partyId,
          partialR,
          partialS,
          commitment: keccak256(toBytes(`${partialR}:${partialS}`)),
        },
      )
      if (result.complete) break
    }

    if (!result.complete || !result.signature)
      throw new Error('Failed to collect threshold signatures')

    return {
      message: toHex(messageBytes),
      signature: result.signature.signature,
      recoveryId: extractRecoveryId(result.signature.signature),
      keyId: request.keyId,
      signedAt: Date.now(),
    }
  }

  async thresholdSign(
    request: ThresholdSignRequest,
  ): Promise<ThresholdSignature> {
    await this.ensureConnected()

    const key = this.keys.get(request.keyId)
    if (!key) throw new Error(`Key ${request.keyId} not found`)

    const messageBytes =
      typeof request.message === 'string'
        ? toBytes(request.message as Hex)
        : request.message
    const session = await this.coordinator.requestSignature({
      keyId: key.mpcKeyId,
      message: toHex(messageBytes),
      messageHash: keccak256(messageBytes),
      requester: key.metadata.owner,
    })
    const partyIds = this.coordinator
      .getActiveParties()
      .slice(0, request.threshold)
      .map((p) => p.id)

    let result: {
      complete: boolean
      signature?: { signature: Hex; participants: string[] }
    } = { complete: false }

    for (const partyId of partyIds) {
      const partialR = keccak256(toBytes(`${session.sessionId}:${partyId}:r`))
      const partialS = keccak256(toBytes(`${session.sessionId}:${partyId}:s`))
      result = await this.coordinator.submitPartialSignature(
        session.sessionId,
        partyId,
        {
          partyId,
          partialR,
          partialS,
          commitment: keccak256(toBytes(`${partialR}:${partialS}`)),
        },
      )
      if (result.complete) break
    }

    if (!result.complete || !result.signature)
      throw new Error('Failed to collect threshold signatures')

    return {
      signature: result.signature.signature,
      participantCount: result.signature.participants.length,
      threshold: request.threshold,
      keyId: request.keyId,
      signedAt: Date.now(),
    }
  }

  async getSigningSession(
    sessionId: string,
  ): Promise<MPCSigningSession | null> {
    const session = this.coordinator.getSession(sessionId)
    if (!session) return null

    const activeParties = this.coordinator.getActiveParties()
    const participantAddresses: Address[] = []
    for (const id of session.participants) {
      const party = activeParties.find((p) => p.id === id)
      if (!party) throw new Error(`Party ${id} not found in active parties`)
      participantAddresses.push(party.address)
    }

    return {
      sessionId: session.sessionId,
      keyId: session.keyId,
      message: session.messageHash,
      participants: participantAddresses,
      threshold: session.threshold,
      collectedShares: session.reveals.size,
      status: session.status === 'expired' ? 'failed' : session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }
  }

  async refreshShares(keyId: string): Promise<void> {
    await this.ensureConnected()
    const key = this.keys.get(keyId)
    if (!key) throw new Error(`Key ${keyId} not found`)
    await this.coordinator.rotateKey({
      keyId: key.mpcKeyId,
      preserveAddress: true,
    })
    key.versions = this.coordinator.getKeyVersions(key.mpcKeyId)
  }

  private policyToAccessPolicy(
    policy: AccessControlPolicy,
  ):
    | { type: 'open' }
    | { type: 'role'; roles: string[] }
    | { type: 'stake'; minStake: bigint } {
    const condition = policy.conditions[0]
    if (!condition) return { type: 'open' }
    switch (condition.type) {
      case 'role':
        return { type: 'role', roles: [condition.role] }
      case 'stake':
        return {
          type: 'stake',
          minStake: BigInt(Math.floor(condition.minStakeUSD * 1e18)),
        }
      default:
        return { type: 'open' }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect()
  }

  getStatus(): {
    connected: boolean
    threshold: number
    totalParties: number
    activeParties: number
    keyCount: number
  } {
    const coordStatus = this.coordinator.getStatus()
    return {
      connected: this.connected,
      threshold: this.config.threshold,
      totalParties: this.config.totalParties,
      activeParties: coordStatus.activeParties,
      keyCount: coordStatus.totalKeys,
    }
  }
}

let mpcProvider: MPCProvider | null = null

export function getMPCProvider(config?: Partial<MPCConfig>): MPCProvider {
  if (!mpcProvider) {
    const networkEnv = process.env.MPC_NETWORK
    const network =
      networkEnv === 'mainnet' || networkEnv === 'testnet'
        ? networkEnv
        : 'localnet'
    const defaultThreshold = network === 'mainnet' ? 3 : 2
    const defaultTotal = network === 'mainnet' ? 5 : 3

    const threshold =
      config?.threshold ??
      parseEnvInt(process.env.MPC_THRESHOLD, defaultThreshold)
    const totalParties =
      config?.totalParties ??
      parseEnvInt(process.env.MPC_TOTAL_PARTIES, defaultTotal)
    const coordinatorEndpoint =
      config?.coordinatorEndpoint ?? process.env.MPC_COORDINATOR_ENDPOINT

    mpcProvider = new MPCProvider({
      threshold,
      totalParties,
      coordinatorEndpoint,
    })
  }
  return mpcProvider
}

export function resetMPCProvider(): void {
  if (mpcProvider) {
    mpcProvider
      .disconnect()
      .catch((e: Error) =>
        log.warn('MPC provider disconnect failed', { error: e.message }),
      )
    mpcProvider = null
  }
}
