/**
 * TEE Provider - Local AES-256-GCM encrypted key storage
 *
 * For production hardware TEE, deploy your own TEE worker and set TEE_ENDPOINT.
 * Without TEE_ENDPOINT, runs in local encrypted mode using TEE_ENCRYPTION_SECRET.
 *
 * ⚠️ SIDE-CHANNEL SECURITY NOTE:
 * This provider stores the encryption key (enclaveKey) in memory. If a TEE
 * side-channel attack (Spectre, Meltdown, cache-timing) can read memory,
 * all private keys protected by this provider can be compromised.
 *
 * FOR MAXIMUM SECURITY:
 * - Use remote TEE mode with hardware attestation (set TEE_ENDPOINT)
 * - For signing operations, prefer MPC/FROST threshold signing where no
 *   single TEE ever holds the complete private key
 * - Consider hardware security modules (HSM) for master key storage
 */

import { getEnv, getEnvBoolean, requireEnv } from '@jejunetwork/shared'
import type { TEEAttestation } from '@jejunetwork/types'
import { type Address, type Hex, keccak256, toBytes, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  type AttestationVerifier,
  createAttestationVerifier,
} from '../attestation-verifier.js'
import {
  decryptFromPayload,
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
  private enclaveKeyInitialized = false
  private keys = new Map<string, EnclaveKey>()
  private attestation: TEEAttestation | undefined = undefined
  private teeClient: TEEClient | undefined = undefined
  private attestationVerifier: AttestationVerifier

  constructor(config: TEEConfig) {
    this.config = config
    this.remoteMode = !!config.endpoint

    // SECURITY: Production MUST use remote TEE with hardware attestation
    const isProduction = getEnv('NODE_ENV') === 'production'
    if (isProduction && !this.remoteMode) {
      throw new Error(
        'Production requires remote TEE with hardware attestation. ' +
        'Set TEE_ENDPOINT to a hardware TEE endpoint. ' +
        'Local encrypted mode is vulnerable to side-channel attacks.',
      )
    }

    this.teeClient = config.endpoint
      ? new TEEClient(config.endpoint)
      : undefined

    // SECURITY: Use PBKDF2 with high iteration count for key derivation
    // This protects against brute-force attacks if the secret is observed
    const secret = requireEnv('TEE_ENCRYPTION_SECRET')
    this.enclaveKey = new Uint8Array(32) // Placeholder, initialized in connect()
    this.initializeEnclaveKey(secret)

    // Configure attestation verifier based on mode
    // SECURITY: In production, never allow local mode bypass
    const teeType = this.remoteMode
      ? ((getEnv('TEE_TYPE') as 'sgx' | 'nitro') ?? 'sgx')
      : 'local'
    const allowLocalFallback = !isProduction && (
      !this.remoteMode || getEnvBoolean('TEE_ALLOW_LOCAL', false)
    )
    this.attestationVerifier = createAttestationVerifier({
      teeType,
      allowLocalMode: allowLocalFallback,
      iasApiKey: getEnv('INTEL_IAS_API_KEY'),
      maxAttestationAgeMs: 60 * 60 * 1000, // 1 hour
    })

    if (isProduction) {
      log.info('TEE Provider initialized in production mode', {
        remoteMode: this.remoteMode,
        teeType,
        attestationRequired: true,
      })
    } else if (!this.remoteMode) {
      log.warn(
        'TEE Provider running in LOCAL ENCRYPTED mode (development only). ' +
        'This is INSECURE and vulnerable to side-channel attacks.'
      )
    }
  }

  /**
   * Initialize enclave key using PBKDF2 with high iteration count.
   *
   * SECURITY: Uses 100,000 iterations of PBKDF2-SHA256 to derive the key.
   * This provides resistance against brute-force attacks even if the
   * derived key material is observed through side-channel attacks.
   *
   * Additionally uses a domain-specific salt to prevent rainbow table attacks.
   */
  private async initializeEnclaveKey(secret: string): Promise<void> {
    if (this.enclaveKeyInitialized) return

    const encoder = new TextEncoder()
    const secretBytes = encoder.encode(secret)

    // Domain-specific salt for TEE enclave key derivation
    const salt = encoder.encode('jeju:tee:enclave:v1')

    // Import the secret as key material for PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      'PBKDF2',
      false,
      ['deriveBits'],
    )

    // Derive 256 bits using PBKDF2 with 100,000 iterations
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    )

    this.enclaveKey = new Uint8Array(derivedBits)
    this.enclaveKeyInitialized = true

    log.info('Enclave key initialized with PBKDF2')
  }

  async isAvailable(): Promise<boolean> {
    if (this.remoteMode && this.teeClient) {
      return this.teeClient.checkHealth()
    }
    return true
  }

  async connect(): Promise<void> {
    if (this.connected) return

    // Ensure enclave key is initialized (async PBKDF2)
    const secret = requireEnv('TEE_ENCRYPTION_SECRET')
    await this.initializeEnclaveKey(secret)

    if (this.remoteMode && this.teeClient) {
      const data = await this.teeClient.connect()

      if (!data) {
        throw new Error(
          `Remote TEE endpoint unavailable: ${this.config.endpoint}`,
        )
      }

      // SECURITY: Verify attestation BEFORE accepting enclave key
      if (data.attestation) {
        const attestation: TEEAttestation = {
          quote: data.attestation.quote as Hex,
          measurement: data.attestation.measurement as Hex,
          timestamp: data.attestation.timestamp,
          verified: data.attestation.verified,
          verifierSignature: data.attestation.verifierSignature as
            | Hex
            | undefined,
        }
        const attestationValid =
          await this.attestationVerifier.verify(attestation)
        if (!attestationValid.valid) {
          throw new Error(
            `Remote TEE attestation verification failed: ${attestationValid.error ?? 'unknown error'}`,
          )
        }
        this.attestation = attestation
        log.info('Remote TEE attestation verified', {
          teeType: attestationValid.teeType,
          measurementTrusted: attestationValid.measurementTrusted,
        })
      } else {
        // SECURITY: Require attestation for remote TEE connections
        throw new Error(
          'Remote TEE did not provide attestation - connection rejected',
        )
      }

      // Only accept enclave key AFTER attestation is verified
      if (data.enclaveKey) {
        this.enclaveKey = toBytes(data.enclaveKey)
        log.info('Accepted enclave key from verified remote TEE')
      }

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
          publicKey: result.publicKey as Hex,
          address: result.address as Address,
        })
        return { metadata, publicKey: result.publicKey as Hex }
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
          signature: result.signature as Hex,
          recoveryId: parseInt(result.signature.slice(130, 132), 16) - 27,
          keyId: request.keyId,
          signedAt: Date.now(),
        }
      }

      // Cannot fallback to local if key was generated remotely (no local private key)
      if (key.encryptedPrivateKey.length === 0) {
        throw new Error(
          `Remote signing failed for key ${request.keyId} and no local fallback available`,
        )
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
