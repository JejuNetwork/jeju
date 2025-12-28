/**
 * Encryption Provider - AES-256-GCM with policy-based access control
 *
 * Access conditions:
 * - 'timestamp': Verified locally
 * - 'balance', 'stake', 'role', 'agent', 'contract': Verified on-chain
 *
 * ⚠️ SIDE-CHANNEL SECURITY NOTE:
 * The master encryption key is stored in memory (this.masterKey). If a TEE
 * side-channel attack can read memory, ALL encrypted data can be decrypted.
 *
 * FOR MAXIMUM SECURITY:
 * - Use MPC-based encryption where the key is split across parties
 * - Consider HSM-backed key storage for the master key
 * - Implement key rotation schedules to limit exposure window
 */

import { getEnv, getEnvBoolean, requireEnv } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  constantTimeCompare,
  decryptFromPayload,
  deriveKeyForEncryption,
  deriveKeyFromSecret,
  deriveKeyFromSecretAsync,
  encryptToPayload,
  extractRecoveryId,
  generateKeyId,
  parseCiphertextPayload,
  sealWithMasterKey,
  unsealWithMasterKey,
} from '../crypto.js'
import { encLogger as log } from '../logger.js'
import { getOnChainVerifier } from '../on-chain-verifier.js'
import {
  type AccessCondition,
  type AccessControlPolicy,
  type AgentCondition,
  type AuthSignature,
  type BalanceCondition,
  ConditionOperator,
  type ContractCondition,
  type DecryptRequest,
  type EncryptedPayload,
  type EncryptionConfig,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  type KeyMetadata,
  type KeyType,
  type KMSProvider,
  KMSProviderType,
  type RoleCondition,
  type SessionKey,
  type SignedMessage,
  type SignRequest,
  type StakeCondition,
} from '../types.js'

interface EncryptionKey {
  id: string
  metadata: KeyMetadata
  encryptedKey: Uint8Array
  publicKey: Hex
  address: Address
  version: number
  createdAt: number
}

interface KeyVersionRecord {
  version: number
  encryptedKey: Uint8Array
  createdAt: number
  rotatedAt?: number
  status: 'active' | 'rotated' | 'revoked'
}

interface Session {
  sessionKey: SessionKey
  address: Address
  capabilities: string[]
  createdAt: number
}

export class EncryptionProvider implements KMSProvider {
  type = KMSProviderType.ENCRYPTION
  private connected = false
  private masterKey: Uint8Array | null = null
  private keys = new Map<string, EncryptionKey>()
  private keyVersions = new Map<string, KeyVersionRecord[]>()
  private sessions = new Map<string, Session>()
  private initPromise: Promise<void> | null = null
  private useAsyncDerivation: boolean

  constructor(_config: EncryptionConfig) {
    // Check if async derivation is enabled (recommended for production)
    this.useAsyncDerivation = getEnvBoolean(
      'KMS_USE_ASYNC_KEY_DERIVATION',
      false,
    )

    if (!this.useAsyncDerivation) {
      // Legacy synchronous derivation (fast but less secure)
      const secret = requireEnv('KMS_ENCRYPTION_SECRET')
      this.masterKey = deriveKeyFromSecret(secret)
    }
  }

  /**
   * Initialize master key using async derivation (PBKDF2)
   *
   * SECURITY: PBKDF2 with 100k iterations provides resistance against
   * brute-force attacks if the derived key is observed via side-channel.
   */
  private async initializeMasterKey(): Promise<void> {
    if (this.masterKey) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      const secret = requireEnv('KMS_ENCRYPTION_SECRET')
      this.masterKey = await deriveKeyFromSecretAsync(
        secret,
        'jeju:kms:encryption:v1',
      )
      log.info('Master key derived using PBKDF2 (100k iterations)')
    })()

    return this.initPromise
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async connect(): Promise<void> {
    if (this.connected) return
    // Initialize master key with async derivation if enabled
    if (this.useAsyncDerivation) {
      await this.initializeMasterKey()
    }
    this.connected = true
    log.info('Encryption provider initialized', {
      asyncDerivation: this.useAsyncDerivation,
    })
  }

  async disconnect(): Promise<void> {
    if (this.masterKey) {
      this.masterKey.fill(0)
    }
    for (const key of this.keys.values()) key.encryptedKey.fill(0)
    for (const versions of this.keyVersions.values()) {
      for (const v of versions) v.encryptedKey.fill(0)
    }
    this.keys.clear()
    this.keyVersions.clear()
    this.sessions.clear()
    this.connected = false
  }

  async generateKey(
    owner: Address,
    keyType: KeyType,
    curve: KeyCurve,
    policy: AccessControlPolicy,
  ): Promise<GeneratedKey> {
    await this.ensureConnected()

    const keyId = generateKeyId('enc')
    const keyBytes = crypto.getRandomValues(new Uint8Array(32))
    const keyHex = toHex(keyBytes) as `0x${string}`
    const account = privateKeyToAccount(keyHex)
    const encryptedKey = await sealWithMasterKey(keyBytes, this.getMasterKey())
    keyBytes.fill(0)

    const metadata: KeyMetadata = {
      id: keyId,
      type: keyType,
      curve,
      createdAt: Date.now(),
      owner,
      policy,
      providerType: KMSProviderType.ENCRYPTION,
    }

    const encKey: EncryptionKey = {
      id: keyId,
      metadata,
      encryptedKey,
      publicKey: toHex(account.publicKey),
      address: account.address,
      version: 1,
      createdAt: Date.now(),
    }

    this.keys.set(keyId, encKey)
    this.keyVersions.set(keyId, [
      {
        version: 1,
        encryptedKey: new Uint8Array(encryptedKey),
        createdAt: Date.now(),
        status: 'active',
      },
    ])

    return { metadata, publicKey: encKey.publicKey }
  }

  getKey(keyId: string): KeyMetadata | undefined {
    return this.keys.get(keyId)?.metadata
  }

  getKeyVersions(keyId: string): KeyVersionRecord[] {
    const versions = this.keyVersions.get(keyId)
    if (!versions) throw new Error(`Key versions not found for ${keyId}`)
    return versions
  }

  async revokeKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId)
    if (key) {
      key.encryptedKey.fill(0)
      this.keys.delete(keyId)
      const versions = this.keyVersions.get(keyId)
      if (versions) for (const v of versions) v.status = 'revoked'
    }
  }

  async encrypt(request: EncryptRequest): Promise<EncryptedPayload> {
    await this.ensureConnected()

    const dataStr =
      typeof request.data === 'string'
        ? request.data
        : new TextDecoder().decode(request.data)
    const keyId = request.keyId ?? generateKeyId('enc')

    let encryptionKey: Uint8Array
    let version = 1

    const existingKey = this.keys.get(keyId)
    if (existingKey) {
      encryptionKey = await unsealWithMasterKey(
        existingKey.encryptedKey,
        this.getMasterKey(),
      )
      version = existingKey.version
    } else {
      encryptionKey = await deriveKeyForEncryption(
        this.getMasterKey(),
        keyId,
        JSON.stringify(request.policy),
      )
    }

    const ciphertext = await encryptToPayload(dataStr, encryptionKey, {
      version,
    })
    encryptionKey.fill(0)

    return {
      ciphertext,
      dataHash: keccak256(toBytes(dataStr)),
      accessControlHash: keccak256(
        toBytes(JSON.stringify(request.policy.conditions)),
      ),
      policy: request.policy,
      providerType: KMSProviderType.ENCRYPTION,
      encryptedAt: Math.floor(Date.now() / 1000),
      keyId,
      metadata: request.metadata,
    }
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureConnected()

    const { payload, authSig } = request
    const requesterAddress = authSig?.address

    const allowed = await this.checkAccessControl(
      payload.policy,
      requesterAddress,
    )
    if (!allowed) throw new Error('Access denied: policy conditions not met')

    const parsed = parseCiphertextPayload(payload.ciphertext)
    const version = parsed.version ?? 1

    let decryptionKey: Uint8Array
    const existingKey = this.keys.get(payload.keyId)

    if (existingKey) {
      if (version !== existingKey.version) {
        const versions = this.keyVersions.get(payload.keyId)
        if (!versions)
          throw new Error(`Key versions not found for ${payload.keyId}`)
        const versionRecord = versions.find((v) => v.version === version)
        if (!versionRecord) throw new Error(`Key version ${version} not found`)
        if (versionRecord.status === 'revoked')
          throw new Error(`Key version ${version} has been revoked`)
        decryptionKey = await unsealWithMasterKey(
          versionRecord.encryptedKey,
          this.getMasterKey(),
        )
      } else {
        decryptionKey = await unsealWithMasterKey(
          existingKey.encryptedKey,
          this.getMasterKey(),
        )
      }
    } else {
      decryptionKey = await deriveKeyForEncryption(
        this.getMasterKey(),
        payload.keyId,
        JSON.stringify(payload.policy),
      )
    }

    const result = await decryptFromPayload(payload.ciphertext, decryptionKey)
    decryptionKey.fill(0)

    return result
  }

  async sign(request: SignRequest): Promise<SignedMessage> {
    await this.ensureConnected()

    const key = this.keys.get(request.keyId)
    if (!key) throw new Error(`Key ${request.keyId} not found`)

    const keyBytes = await unsealWithMasterKey(
      key.encryptedKey,
      this.getMasterKey(),
    )
    const account = privateKeyToAccount(toHex(keyBytes) as `0x${string}`)
    keyBytes.fill(0)

    const messageBytes =
      typeof request.message === 'string'
        ? toBytes(request.message as Hex)
        : request.message
    const hash =
      request.hashAlgorithm === 'none'
        ? messageBytes
        : toBytes(keccak256(messageBytes))
    const signature = await account.signMessage({ message: { raw: hash } })

    return {
      message: toHex(messageBytes),
      signature,
      recoveryId: extractRecoveryId(signature),
      keyId: request.keyId,
      signedAt: Date.now(),
    }
  }

  async createSession(
    authSig: AuthSignature,
    capabilities: string[],
    expirationHours = 24,
  ): Promise<SessionKey> {
    await this.ensureConnected()

    const expiration = Date.now() + expirationHours * 60 * 60 * 1000
    const sessionId = generateKeyId('session')
    const publicKey = keccak256(
      toBytes(`${sessionId}:${authSig.address}:${expiration}`),
    )

    const sessionKey: SessionKey = {
      publicKey,
      expiration,
      capabilities,
      authSig,
    }
    this.sessions.set(sessionId, {
      sessionKey,
      address: authSig.address,
      capabilities,
      createdAt: Date.now(),
    })

    return sessionKey
  }

  validateSession(session: SessionKey): boolean {
    if (session.expiration <= Date.now()) return false

    // Iterate over ALL sessions to prevent timing-based session enumeration
    let found = false
    let valid = false

    for (const s of this.sessions.values()) {
      // Use constant-time comparison to prevent timing attacks
      const matches = constantTimeCompare(
        s.sessionKey.publicKey,
        session.publicKey,
      )
      // Only set found/valid on first match, but continue iterating
      if (matches && !found) {
        found = true
        valid = s.sessionKey.expiration > Date.now()
      }
    }

    return found && valid
  }

  async rotateKey(keyId: string): Promise<EncryptionKey> {
    await this.ensureConnected()

    const existingKey = this.keys.get(keyId)
    if (!existingKey) throw new Error(`Key ${keyId} not found`)

    const newKeyBytes = crypto.getRandomValues(new Uint8Array(32))
    const account = privateKeyToAccount(toHex(newKeyBytes) as `0x${string}`)
    const encryptedNewKey = await sealWithMasterKey(
      newKeyBytes,
      this.getMasterKey(),
    )
    newKeyBytes.fill(0)

    const newVersion = existingKey.version + 1
    const versions = this.keyVersions.get(keyId)
    if (!versions) throw new Error(`Key versions not found for ${keyId}`)

    const currentVersion = versions.find((v) => v.status === 'active')
    if (currentVersion) {
      currentVersion.status = 'rotated'
      currentVersion.rotatedAt = Date.now()
    }

    versions.push({
      version: newVersion,
      encryptedKey: new Uint8Array(encryptedNewKey),
      createdAt: Date.now(),
      status: 'active',
    })
    this.keyVersions.set(keyId, versions)

    existingKey.encryptedKey = encryptedNewKey
    existingKey.publicKey = toHex(account.publicKey)
    existingKey.address = account.address
    existingKey.version = newVersion

    return existingKey
  }

  private async checkAccessControl(
    policy: AccessControlPolicy,
    requesterAddress?: Address,
  ): Promise<boolean> {
    for (const condition of policy.conditions) {
      const result = await this.evaluateCondition(condition, requesterAddress)
      if (policy.operator === 'and' && !result) return false
      if (policy.operator === 'or' && result) return true
    }
    return policy.operator === 'and'
  }

  private async evaluateCondition(
    condition: AccessCondition,
    requesterAddress?: Address,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'timestamp':
        return this.compare(
          Math.floor(Date.now() / 1000),
          condition.comparator,
          condition.value,
        )
      case 'balance':
        if (condition.value === '0') return true
        if (!requesterAddress) {
          log.warn('Balance condition requires requester address')
          return false
        }
        return this.verifyOnChainCondition(
          condition as BalanceCondition,
          requesterAddress,
        )
      case 'stake':
        if (condition.minStakeUSD === 0) return true
        if (!requesterAddress) {
          log.warn('Stake condition requires requester address')
          return false
        }
        return this.verifyOnChainCondition(
          condition as StakeCondition,
          requesterAddress,
        )
      case 'role':
        if (!requesterAddress) {
          log.warn('Role condition requires requester address')
          return false
        }
        return this.verifyOnChainCondition(
          condition as RoleCondition,
          requesterAddress,
        )
      case 'agent':
        if (!requesterAddress) {
          log.warn('Agent condition requires requester address')
          return false
        }
        return this.verifyOnChainCondition(
          condition as AgentCondition,
          requesterAddress,
        )
      case 'contract':
        if (!requesterAddress) {
          log.warn('Contract condition requires requester address')
          return false
        }
        return this.verifyOnChainCondition(
          condition as ContractCondition,
          requesterAddress,
        )
      default:
        return false
    }
  }

  private async verifyOnChainCondition(
    condition:
      | BalanceCondition
      | StakeCondition
      | RoleCondition
      | AgentCondition
      | ContractCondition,
    address: Address,
  ): Promise<boolean> {
    const rpcUrl = getEnv('KMS_RPC_URL')
    if (!rpcUrl) {
      log.warn('KMS_RPC_URL not configured, on-chain verification disabled')
      return false
    }

    const verifier = getOnChainVerifier({ defaultRpcUrl: rpcUrl })
    return verifier.verifyAccessCondition(condition, address)
  }

  private compare(a: number, op: ConditionOperator, b: number): boolean {
    switch (op) {
      case ConditionOperator.EQUALS:
        return a === b
      case ConditionOperator.NOT_EQUALS:
        return a !== b
      case ConditionOperator.GREATER_THAN:
        return a > b
      case ConditionOperator.LESS_THAN:
        return a < b
      case ConditionOperator.GREATER_THAN_OR_EQUAL:
        return a >= b
      case ConditionOperator.LESS_THAN_OR_EQUAL:
        return a <= b
      case ConditionOperator.CONTAINS:
        return false
      default:
        return false
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect()
    if (!this.masterKey) {
      throw new Error('Master key not initialized - call connect() first')
    }
  }

  /**
   * Get the master key, ensuring it's initialized
   */
  private getMasterKey(): Uint8Array {
    if (!this.masterKey) {
      throw new Error('Master key not initialized - call connect() first')
    }
    return this.masterKey
  }

  getStatus(): { connected: boolean; keyCount: number; sessionCount: number } {
    return {
      connected: this.connected,
      keyCount: this.keys.size,
      sessionCount: this.sessions.size,
    }
  }
}

let encryptionProvider: EncryptionProvider | undefined

export function getEncryptionProvider(
  config?: Partial<EncryptionConfig>,
): EncryptionProvider {
  if (!encryptionProvider) {
    const debug = config?.debug ?? getEnvBoolean('KMS_DEBUG', false)
    encryptionProvider = new EncryptionProvider({ debug })
  }
  return encryptionProvider
}

export function resetEncryptionProvider(): void {
  if (encryptionProvider) {
    encryptionProvider
      .disconnect()
      .catch((e: Error) =>
        log.warn('Encryption provider disconnect failed', { error: e.message }),
      )
    encryptionProvider = undefined
  }
}
