/**
 * Network KMS - Unified key management via Encryption, TEE, and MPC providers
 */

import { getEnv, getEnvNumber } from '@jejunetwork/shared'
import type { Address } from 'viem'
import { kmsLogger as log } from './logger.js'
import {
  type EncryptionProvider,
  getEncryptionProvider,
} from './providers/encryption-provider.js'
import { getMPCProvider, MPCProvider } from './providers/mpc-provider.js'
import { getTEEProvider, TEEProvider } from './providers/tee-provider.js'
import { generateKeyOptionsSchema, validateOrThrow } from './schemas.js'
import {
  type AccessControlPolicy,
  type AuthSignature,
  type DecryptRequest,
  type EncryptedPayload,
  type EncryptRequest,
  type GeneratedKey,
  type KeyCurve,
  type KeyMetadata,
  type KeyType,
  type KMSConfig,
  type KMSProvider,
  KMSProviderType,
  type ProviderStatus,
  type SessionKey,
  type SignedMessage,
  type SignRequest,
  type ThresholdSignature,
  type ThresholdSignRequest,
} from './types.js'

type ConcreteProvider = EncryptionProvider | TEEProvider | MPCProvider

export class KMSService {
  private config: KMSConfig
  private providers = new Map<KMSProviderType, KMSProvider>()
  private initialized = false

  constructor(config: KMSConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    const providerConfigs: [
      KMSProviderType,
      (() => KMSProvider) | undefined,
    ][] = [
      [
        KMSProviderType.ENCRYPTION,
        this.config.providers.encryption
          ? () => getEncryptionProvider(this.config.providers.encryption)
          : undefined,
      ],
      [
        KMSProviderType.TEE,
        this.config.providers.tee
          ? () => getTEEProvider(this.config.providers.tee)
          : undefined,
      ],
      [
        KMSProviderType.MPC,
        this.config.providers.mpc
          ? () => getMPCProvider(this.config.providers.mpc)
          : undefined,
      ],
    ]

    for (const [type, factory] of providerConfigs) {
      if (factory) this.providers.set(type, factory())
    }

    const defaultProvider = this.providers.get(this.config.defaultProvider)
    if (defaultProvider) await defaultProvider.connect()

    this.initialized = true
    log.info('Initialized', { providers: Array.from(this.providers.keys()) })
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      Array.from(this.providers.values()).map((p) => p.disconnect()),
    )
    this.providers.clear()
    this.initialized = false
  }

  private async getAvailableProvider(
    preferred?: KMSProviderType,
  ): Promise<ConcreteProvider> {
    const type = preferred ?? this.config.defaultProvider
    const provider = this.providers.get(type) as ConcreteProvider | undefined
    if (!provider) {
      throw new Error(`KMS provider not configured: ${type}`)
    }
    if (!(await provider.isAvailable())) {
      throw new Error(`KMS provider not available: ${type}`)
    }
    return provider
  }

  async generateKey(
    owner: Address,
    options: {
      type?: KeyType
      curve?: KeyCurve
      policy: AccessControlPolicy
      provider?: KMSProviderType
    },
  ): Promise<GeneratedKey> {
    await this.ensureInitialized()
    validateOrThrow(
      generateKeyOptionsSchema,
      options,
      'Invalid generateKey options',
    )
    const keyType: KeyType = options.type ?? 'encryption'
    const curve: KeyCurve = options.curve ?? 'secp256k1'
    const provider = await this.getAvailableProvider(options.provider)
    return provider.generateKey(owner, keyType, curve, options.policy)
  }

  getKey(keyId: string): KeyMetadata | undefined {
    for (const provider of this.providers.values()) {
      const key = (provider as ConcreteProvider).getKey(keyId)
      if (key) return key
    }
    return undefined
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.ensureInitialized()
    for (const provider of this.providers.values()) {
      const p = provider as ConcreteProvider
      if (p.getKey(keyId)) {
        await p.revokeKey(keyId)
        return
      }
    }
    throw new Error(`Key not found: ${keyId}`)
  }

  async encrypt(
    request: EncryptRequest,
    provider?: KMSProviderType,
  ): Promise<EncryptedPayload> {
    await this.ensureInitialized()
    return (await this.getAvailableProvider(provider)).encrypt(request)
  }

  async decrypt(request: DecryptRequest): Promise<string> {
    await this.ensureInitialized()
    const provider = this.providers.get(request.payload.providerType) as
      | ConcreteProvider
      | undefined
    if (!provider)
      throw new Error(`Provider not available: ${request.payload.providerType}`)
    return provider.decrypt(request)
  }

  async sign(
    request: SignRequest,
    provider?: KMSProviderType,
  ): Promise<SignedMessage> {
    await this.ensureInitialized()
    if (!request.keyId) throw new Error('keyId is required for signing')
    const signingTypes = [KMSProviderType.TEE, KMSProviderType.MPC]
    const preferredType =
      provider ?? signingTypes.find((t) => this.providers.has(t))
    if (!preferredType) throw new Error('No signing-capable provider available')

    const p = await this.getAvailableProvider(preferredType)
    if (!(p instanceof TEEProvider) && !(p instanceof MPCProvider))
      throw new Error('Provider does not support signing')
    return p.sign(request)
  }

  async thresholdSign(
    request: ThresholdSignRequest,
  ): Promise<ThresholdSignature> {
    await this.ensureInitialized()
    const mpc = this.providers.get(KMSProviderType.MPC) as
      | MPCProvider
      | undefined
    if (!mpc) throw new Error('MPC provider required for threshold signing')
    return mpc.thresholdSign(request)
  }

  async createSession(
    authSig: AuthSignature,
    capabilities: string[],
    expirationHours = 24,
  ): Promise<SessionKey> {
    await this.ensureInitialized()
    const enc = this.providers.get(KMSProviderType.ENCRYPTION) as
      | EncryptionProvider
      | undefined
    if (!enc)
      throw new Error('Encryption provider required for session management')
    return enc.createSession(authSig, capabilities, expirationHours)
  }

  validateSession(session: SessionKey): boolean {
    const enc = this.providers.get(KMSProviderType.ENCRYPTION) as
      | EncryptionProvider
      | undefined
    if (!enc) return false
    return enc.validateSession(session)
  }

  getStatus(): {
    initialized: boolean
    providers: Record<string, { available: boolean; status: ProviderStatus }>
    defaultProvider: KMSProviderType
  } {
    const providers: Record<
      string,
      { available: boolean; status: ProviderStatus }
    > = {}
    for (const [type, provider] of this.providers.entries()) {
      const status = (provider as ConcreteProvider).getStatus()
      providers[type] = { available: status.connected, status }
    }
    return {
      initialized: this.initialized,
      providers,
      defaultProvider: this.config.defaultProvider,
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize()
  }
}

let kmsService: KMSService | undefined

function buildKMSConfig(config?: Partial<KMSConfig>): KMSConfig {
  const encryptionConfig = config?.providers?.encryption ?? {
    debug: getEnv('KMS_DEBUG') === 'true',
  }

  let teeConfig = config?.providers?.tee
  const teeEndpoint = getEnv('TEE_ENDPOINT')
  if (!teeConfig && teeEndpoint) {
    teeConfig = { endpoint: teeEndpoint }
  }

  let mpcConfig = config?.providers?.mpc
  const mpcCoordinatorEndpoint = getEnv('MPC_COORDINATOR_ENDPOINT')
  if (!mpcConfig && mpcCoordinatorEndpoint) {
    const threshold = getEnvNumber('MPC_THRESHOLD', 2)
    const totalParties = getEnvNumber('MPC_TOTAL_PARTIES', 3)
    mpcConfig = {
      threshold,
      totalParties,
      coordinatorEndpoint: mpcCoordinatorEndpoint,
    }
  }

  const defaultProviderEnv = getEnv('KMS_DEFAULT_PROVIDER')
  let defaultProvider: KMSProviderType
  if (config?.defaultProvider) {
    defaultProvider = config.defaultProvider
  } else if (
    defaultProviderEnv === 'encryption' ||
    defaultProviderEnv === 'tee' ||
    defaultProviderEnv === 'mpc'
  ) {
    defaultProvider = defaultProviderEnv as KMSProviderType
  } else {
    defaultProvider = KMSProviderType.ENCRYPTION
  }

  const defaultChain =
    config?.defaultChain ?? getEnv('KMS_DEFAULT_CHAIN') ?? 'base-sepolia'

  return {
    providers: { encryption: encryptionConfig, tee: teeConfig, mpc: mpcConfig },
    defaultProvider,
    defaultChain,
    registryAddress: config?.registryAddress,
  }
}

export function getKMS(config?: Partial<KMSConfig>): KMSService {
  if (!kmsService) {
    kmsService = new KMSService(buildKMSConfig(config))
  }
  return kmsService
}

export function resetKMS(): void {
  kmsService
    ?.shutdown()
    .catch((e) => log.error('Shutdown failed', { error: String(e) }))
  kmsService = undefined
}
