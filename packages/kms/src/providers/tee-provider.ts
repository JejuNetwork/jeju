/**
 * TEE Provider - Local AES-256-GCM encrypted key storage
 *
 * For production hardware TEE, deploy your own TEE worker and set TEE_ENDPOINT.
 * Without TEE_ENDPOINT, runs in local encrypted mode using TEE_ENCRYPTION_SECRET.
 */

import { getEnv, getEnvBoolean, requireEnv } from '@jejunetwork/shared'
import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  type AttestationVerifier,
  createAttestationVerifier,
} from '../attestation-verifier.js'
import {
  decryptFromPayload,
  deriveKeyFromSecret,
  encryptToPayload,
  extractRecoveryId,
  generateKeyId,
  sealWithMasterKey,
  unsealWithMasterKey,
} from '../crypto.js'
import { TEEClient } from '../eden-client.js'
import { teeLogger as log } from '../logger.js'
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
  private attestation: TEEAttestation | undefined = undefined
  private teeClient: TEEClient | undefined = undefined
  private attestationVerifier: AttestationVerifier

  constructor(config: TEEConfig) {
    this.config = config
    this.remoteMode = !!config.endpoint

    this.teeClient = config.endpoint
      ? new TEEClient(config.endpoint)
      : undefined

    const secret = requireEnv('TEE_ENCRYPTION_SECRET')
    this.enclaveKey = deriveKeyFromSecret(secret)

    // Configure attestation verifier based on mode
    const teeType = this.remoteMode
      ? ((getEnv('TEE_TYPE') as 'sgx' | 'nitro') ?? 'sgx')
      : 'local'
    this.attestationVerifier = createAttestationVerifier({
      teeType,
      allowLocalMode: !this.remoteMode || getEnvBoolean('TEE_ALLOW_LOCAL', false),
      iasApiKey: getEnv('INTEL_IAS_API_KEY'),
      maxAttestationAgeMs: 60 * 60 * 1000, // 1 hour
    })
  }

  async isAvailable(): Promise<boolean> {
    if (this.remoteMode && this.teeClient) {
      return this.teeClient.checkHealth()
    }
    return true
  }

  async connect(): Promise<void> {
    if (this.connected) return

    if (this.remoteMode && this.teeClient) {
      const data = await this.teeClient.connect()

      if (!data) {
        throw new Error(
          `Remote TEE endpoint unavailable: ${this.config.endpoint}`,
        )
      }
      if (data.attestation) this.attestation = data.attestation
      if (data.enclaveKey) this.enclaveKey = toBytes(data.enclaveKey)
      log.info('Connected to remote TEE', {
        endpoint: this.config.endpoint,
      })
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
    this.attestation = undefined
  }

  async generateKey(
    owner: Address,
    keyType: KeyType,
    curve: KeyCurve,
    policy: AccessControlPolicy,
  ): Promise<GeneratedKey> {
    await this.ensureConnected()
    const keyId = generateKeyId('tee')

    if (this.remoteMode && this.teeClient) {
      const result = await this.teeClient.generateKey({
        keyId,
        owner,
        keyType,
        curve,
        policy,
      })

      if (result) {
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
          publicKey: result.publicKey,
          address: result.address,
        })
        return { metadata, publicKey: result.publicKey }
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

  getKey(keyId: string): KeyMetadata | undefined {
    return this.keys.get(keyId)?.metadata
  }

  async revokeKey(keyId: string): Promise<void> {
    const key = this.keys.get(keyId)
    if (!key) return
    if (this.remoteMode && this.teeClient) {
      const success = await this.teeClient.revokeKey(keyId)
      if (!success) {
        log.warn('Remote key revocation failed', { keyId })
      }
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

    if (this.remoteMode && this.teeClient) {
      const result = await this.teeClient.sign(request.keyId, {
        message: request.message,
        hashAlgorithm: request.hashAlgorithm,
      })

      if (result) {
        return {
          message: toHex(
            typeof request.message === 'string'
              ? toBytes(request.message as Hex)
              : request.message,
          ),
          signature: result.signature,
          recoveryId: parseInt(result.signature.slice(130, 132), 16) - 27,
          keyId: request.keyId,
          signedAt: Date.now(),
        }
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
    const result = await this.attestationVerifier.verify(attestation)

    if (!result.valid) {
      log.warn('Attestation verification failed', {
        error: result.error,
        teeType: result.teeType,
        fresh: result.fresh,
        measurementTrusted: result.measurementTrusted,
      })
    }

    return result.valid
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) await this.connect()
  }

  getStatus(): {
    connected: boolean
    mode: 'remote' | 'local'
    attestation?: TEEAttestation
  } {
    return {
      connected: this.connected,
      mode: this.remoteMode ? 'remote' : 'local',
      attestation: this.attestation,
    }
  }
}

let teeProvider: TEEProvider | undefined

export function getTEEProvider(config?: Partial<TEEConfig>): TEEProvider {
  if (!teeProvider) {
    const endpoint = config?.endpoint ?? getEnv('TEE_ENDPOINT')
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
    teeProvider = undefined
  }
}
