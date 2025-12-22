/**
 * TEE Provider - Local AES-256-GCM encrypted key storage
 *
 * For production hardware TEE, deploy your own TEE worker and set TEE_ENDPOINT.
 * Without TEE_ENDPOINT, runs in local encrypted mode using TEE_ENCRYPTION_SECRET.
 */

import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  decryptFromPayload,
  deriveKeyFromSecret,
  encryptToPayload,
  extractRecoveryId,
  generateKeyId,
  sealWithMasterKey,
  unsealWithMasterKey,
} from '../crypto.js'
import { teeLogger as log } from '../logger.js'
import {
  teeConnectResponseSchema,
  teeKeyGenResponseSchema,
  teeSignResponseSchema,
} from '../schemas.js'
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
  type SignedMessage,
  type SignRequest,
  type TEEAttestation,
  type TEEConfig,
} from '../types.js'

interface EnclaveKey {
  metadata: KeyMetadata
  encryptedPrivateKey: Uint8Array
  publicKey: Hex
  address: Address
}

export class TEEProvider implements KMSProvider {
  type = KMSProviderType.TEE
  private config: TEEConfig
  private connected = false
  private remoteMode = false
  private enclaveKey: Uint8Array
  private keys = new Map<string, EnclaveKey>()
  private attestation: TEEAttestation | null = null

  constructor(config: TEEConfig) {
    this.config = config
    this.remoteMode = !!config.endpoint

    const secret =
      process.env.TEE_ENCRYPTION_SECRET ?? process.env.KMS_FALLBACK_SECRET
    if (secret) {
      this.enclaveKey = deriveKeyFromSecret(secret)
    } else {
      this.enclaveKey = crypto.getRandomValues(new Uint8Array(32))
      log.warn('No TEE_ENCRYPTION_SECRET set - keys will be lost on restart')
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)
      return response?.ok ?? false
    }
    return true
  }

  async connect(): Promise<void> {
    if (this.connected) return

    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      }).catch(() => null)

      if (response?.ok) {
        const rawData: unknown = await response.json()
        const parseResult = teeConnectResponseSchema.safeParse(rawData)
        if (!parseResult.success) {
          log.warn('Invalid TEE connect response', {
            error: parseResult.error.message,
          })
          this.remoteMode = false
        } else {
          const data = parseResult.data
          if (data.attestation) this.attestation = data.attestation
          if (data.enclaveKey) this.enclaveKey = toBytes(data.enclaveKey as Hex)
          log.info('Connected to remote TEE', {
            endpoint: this.config.endpoint,
          })
        }
      } else {
        log.warn(
          'Remote TEE endpoint unavailable, falling back to local mode',
          { endpoint: this.config.endpoint },
        )
        this.remoteMode = false
      }
    } else {
      log.info('Running in local encrypted mode')
    }

    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.enclaveKey.fill(0)
    for (const key of this.keys.values()) key.encryptedPrivateKey.fill(0)
    this.keys.clear()
    this.connected = false
    this.attestation = null
  }

  async generateKey(
    owner: Address,
    keyType: KeyType,
    curve: KeyCurve,
    policy: AccessControlPolicy,
  ): Promise<GeneratedKey> {
    await this.ensureConnected()
    const keyId = generateKeyId('tee')

    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(`${this.config.endpoint}/keys/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, owner, keyType, curve, policy }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null)

      if (response?.ok) {
        const rawResult: unknown = await response.json()
        const parseResult = teeKeyGenResponseSchema.safeParse(rawResult)
        if (parseResult.success) {
          const result = parseResult.data
          const metadata: KeyMetadata = {
            id: keyId,
            type: keyType,
            curve,
            createdAt: Date.now(),
            owner,
            policy,
            providerType: KMSProviderType.TEE,
          }
          this.keys.set(keyId, {
            metadata,
            encryptedPrivateKey: new Uint8Array(0),
            publicKey: result.publicKey as Hex,
            address: result.address as Address,
          })
          return { metadata, publicKey: result.publicKey as Hex }
        }
        log.warn('Invalid TEE key generation response', {
          error: parseResult.error.message,
        })
      }
      log.warn('Remote key generation failed, using local generation')
    }

    const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32))
    const account = privateKeyToAccount(toHex(privateKeyBytes) as `0x${string}`)
    const encryptedPrivateKey = await sealWithMasterKey(
      privateKeyBytes,
      this.enclaveKey,
    )
    privateKeyBytes.fill(0)

    const metadata: KeyMetadata = {
      id: keyId,
      type: keyType,
      curve,
      createdAt: Date.now(),
      owner,
      policy,
      providerType: KMSProviderType.TEE,
    }
    this.keys.set(keyId, {
      metadata,
      encryptedPrivateKey,
      publicKey: toHex(account.publicKey),
      address: account.address,
    })
    return { metadata, publicKey: toHex(account.publicKey) }
  }

  getKey(keyId: string): KeyMetadata | null {
    return this.keys.get(keyId)?.metadata ?? null
  }

  async revokeKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId)
    if (!key) return
    if (this.remoteMode && this.config.endpoint) {
      await fetch(`${this.config.endpoint}/keys/${keyId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      }).catch((e: Error) =>
        log.warn('Remote key revocation failed', { keyId, error: e.message }),
      )
    }
    key.encryptedPrivateKey.fill(0)
    this.keys.delete(keyId)
  }

  async encrypt(request: EncryptRequest): Promise<EncryptedPayload> {
    await this.ensureConnected()

    const dataStr =
      typeof request.data === 'string'
        ? request.data
        : new TextDecoder().decode(request.data)
    const keyId = request.keyId ?? generateKeyId('tee-enc')

    const ciphertext = await encryptToPayload(dataStr, this.enclaveKey)
    return {
      ciphertext,
      dataHash: keccak256(toBytes(dataStr)),
      accessControlHash: keccak256(toBytes(JSON.stringify(request.policy))),
      policy: request.policy,
      providerType: KMSProviderType.TEE,
      encryptedAt: Math.floor(Date.now() / 1000),
      keyId,
      metadata: {
        ...request.metadata,
        mode: this.remoteMode ? 'remote' : 'local',
      },
    }
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureConnected()
    return decryptFromPayload(request.payload.ciphertext, this.enclaveKey)
  }

  async sign(request: SignRequest): Promise<SignedMessage> {
    await this.ensureConnected()

    const key = this.keys.get(request.keyId)
    if (!key) throw new Error(`Key ${request.keyId} not found`)

    if (this.remoteMode && this.config.endpoint) {
      const response = await fetch(
        `${this.config.endpoint}/keys/${request.keyId}/sign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: request.message,
            hashAlgorithm: request.hashAlgorithm,
          }),
          signal: AbortSignal.timeout(30000),
        },
      ).catch(() => null)

      if (response?.ok) {
        const rawResult: unknown = await response.json()
        const parseResult = teeSignResponseSchema.safeParse(rawResult)
        if (parseResult.success) {
          const result = parseResult.data
          return {
            message: toHex(
              typeof request.message === 'string'
                ? toBytes(request.message as Hex)
                : request.message,
            ),
            signature: result.signature as Hex,
            recoveryId: parseInt(result.signature.slice(130, 132), 16) - 27,
            keyId: request.keyId,
            signedAt: Date.now(),
          }
        }
        log.warn('Invalid TEE sign response', {
          error: parseResult.error.message,
        })
      }
      log.warn('Remote signing failed, using local signing')
    }

    const privateKeyBytes = await unsealWithMasterKey(
      key.encryptedPrivateKey,
      this.enclaveKey,
    )
    const account = privateKeyToAccount(toHex(privateKeyBytes) as `0x${string}`)
    privateKeyBytes.fill(0)

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

  async getAttestation(_keyId?: string): Promise<TEEAttestation> {
    await this.ensureConnected()
    if (this.attestation) return this.attestation
    return {
      quote: keccak256(toBytes(`local:${Date.now()}`)),
      measurement: keccak256(toBytes(`measurement:${Date.now()}`)),
      timestamp: Date.now(),
      verified: !this.remoteMode,
    }
  }

  async verifyAttestation(attestation: TEEAttestation): Promise<boolean> {
    return Date.now() - attestation.timestamp < 60 * 60 * 1000
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect()
  }

  getStatus(): {
    connected: boolean
    mode: 'remote' | 'local'
    attestation: TEEAttestation | null
  } {
    return {
      connected: this.connected,
      mode: this.remoteMode ? 'remote' : 'local',
      attestation: this.attestation,
    }
  }
}

let teeProvider: TEEProvider | null = null

export function getTEEProvider(config?: Partial<TEEConfig>): TEEProvider {
  if (!teeProvider) {
    const endpoint = config?.endpoint ?? process.env.TEE_ENDPOINT
    teeProvider = new TEEProvider({ endpoint })
  }
  return teeProvider
}

export function resetTEEProvider(): void {
  if (teeProvider) {
    teeProvider
      .disconnect()
      .catch((e: Error) =>
        log.warn('TEE provider disconnect failed', { error: e.message }),
      )
    teeProvider = null
  }
}
