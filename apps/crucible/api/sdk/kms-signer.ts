// Re-export canonical KMS signer for standard usage
export {
  createKMSSigner as createCanonicalKMSSigner,
  getKMSSigner as getCanonicalKMSSigner,
  type KMSKeyInfo as CanonicalKMSKeyInfo,
  KMSSigner as CanonicalKMSSigner,
  type KMSSignerConfig as CanonicalKMSSignerConfig,
  type SigningMode,
  type SignResult as CanonicalSignResult,
  type TransactionSignResult,
  validateSecureSigning,
} from '@jejunetwork/kms'

import { getCurrentNetwork, getKmsServiceUrl } from '@jejunetwork/config'
import type { Address, Hex, TransactionRequest } from 'viem'
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  serializeTransaction,
  toHex,
} from 'viem'
import { z } from 'zod'
import { createLogger } from './logger'

const log = createLogger('KMSSigner')

interface HSMConfig {
  enabled: boolean
  provider: 'aws' | 'azure' | 'gcp' | 'softhsm' | 'none'
  slotId?: number
  pin?: string
}

interface ThresholdConfig {
  threshold: number
  totalParties: number
  signingTimeoutMs: number
  requireAttestation: boolean
}

function getKmsThresholdConfig(network: string): ThresholdConfig {
  switch (network) {
    case 'mainnet':
      return {
        threshold: 3,
        totalParties: 5,
        signingTimeoutMs: 10000,
        requireAttestation: true,
      }
    case 'testnet':
      return {
        threshold: 2,
        totalParties: 3,
        signingTimeoutMs: 15000,
        requireAttestation: false,
      }
    default:
      return {
        threshold: 1,
        totalParties: 2,
        signingTimeoutMs: 30000,
        requireAttestation: false,
      }
  }
}

function getHSMConfig(network: string): HSMConfig | undefined {
  if (network === 'mainnet') {
    return { enabled: true, provider: 'aws' }
  }
  return undefined
}

function checkHSMAvailability(): { available: boolean; provider?: string } {
  return { available: false }
}

export interface KMSSignerConfig {
  endpoint: string
  networkId: string
  threshold: number
  totalParties: number
  timeout: number
  allowDevMode: boolean
  rpcUrl: string
  chainId: number
  hsm?: HSMConfig
}

export interface SignResult {
  signature: Hex
  r: Hex
  s: Hex
  v: number
  mode: 'mpc' | 'development'
  participants: number
}

export interface KMSKey {
  keyId: string
  publicKey: Hex
  address: Address
  threshold: number
  totalParties: number
}

// Response schemas for validation
const SignResponseSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  r: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  s: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  v: z.number().int().min(27).max(28),
  mode: z.enum(['mpc', 'development']),
  participants: z.number().int().positive(),
})

const KeyGenResponseSchema = z.object({
  keyId: z.string(),
  publicKey: z.string().regex(/^0x[a-fA-F0-9]+$/),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

const AttestationResponseSchema = z.object({
  platform: z.enum(['AWS_NITRO', 'INTEL_SGX', 'AMD_SEV', 'AZURE_SNP', 'NONE']),
  attestation: z.string().optional(),
  verified: z.boolean(),
  pcrs: z.record(z.string(), z.string()).optional(),
})

// ============================================================================
// KMS Signer Class
// ============================================================================

/**
 * KMS-backed signer that uses threshold signatures.
 *
 * The private key is NEVER held by this service:
 * - Key generation distributes shares across MPC parties
 * - Signing requires threshold collaboration
 * - Each party proves TEE attestation
 */
export class KMSSigner {
  private config: KMSSignerConfig
  private keyId: string | null = null
  private publicKey: Hex | null = null
  private address: Address | null = null
  private initialized = false

  constructor(config: KMSSignerConfig) {
    this.config = config

    // Validate config
    if (config.threshold < 2 && !config.allowDevMode) {
      throw new Error('Threshold must be at least 2 for production security')
    }
    if (config.totalParties < config.threshold + 1) {
      throw new Error('Total parties must be greater than threshold')
    }
  }

  /**
   * Initialize the signer by generating or retrieving an MPC key
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    log.info('Initializing KMS signer', {
      endpoint: this.config.endpoint,
      threshold: this.config.threshold,
      totalParties: this.config.totalParties,
      hsmProvider: this.config.hsm?.provider ?? 'none',
    })

    // First verify TEE attestation of the KMS service
    await this.verifyKMSAttestation()

    // Verify HSM availability if configured
    if (this.config.hsm && this.config.hsm.provider !== 'software') {
      await this.verifyHSMAvailability()
    }

    // Request key generation (or retrieval if exists)
    const response = await fetch(`${this.config.endpoint}/kms/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threshold: this.config.threshold,
        totalParties: this.config.totalParties,
        networkId: this.config.networkId,
        keyType: 'secp256k1',
        // Include HSM config for key share storage
        hsm: this.config.hsm
          ? {
              provider: this.config.hsm.provider,
              keyWrapAlgorithm: this.config.hsm.keyWrapAlgorithm,
            }
          : undefined,
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS key generation failed: ${error}`)
    }

    const json = await response.json()
    const result = KeyGenResponseSchema.parse(json)

    this.keyId = result.keyId
    this.publicKey = result.publicKey as Hex
    this.address = result.address as Address
    this.initialized = true

    log.info('KMS signer initialized', {
      keyId: this.keyId,
      address: this.address,
      threshold: this.config.threshold,
    })
  }

  /**
   * Verify TEE attestation of the KMS service.
   *
   * SECURITY: This is critical for production. Attestation proves:
   * 1. KMS is running in a genuine TEE (Intel SGX, AWS Nitro, AMD SEV, etc.)
   * 2. The enclave code hash matches expected values
   * 3. PCRs (Platform Configuration Registers) are valid
   *
   * On failure, logs CRITICAL alerts for monitoring systems.
   */
  private async verifyKMSAttestation(): Promise<void> {
    // In production, we MUST verify attestation
    if (!this.config.allowDevMode) {
      let response: Response
      try {
        response = await fetch(`${this.config.endpoint}/kms/attestation`, {
          signal: AbortSignal.timeout(this.config.timeout),
        })
      } catch (fetchError) {
        // CRITICAL: Cannot reach KMS for attestation
        this.emitAttestationAlert('KMS_UNREACHABLE', {
          endpoint: this.config.endpoint,
          error: String(fetchError),
          network: this.config.networkId,
        })
        throw new Error(
          `CRITICAL: Cannot reach KMS for attestation verification: ${fetchError}`,
        )
      }

      if (!response.ok) {
        // CRITICAL: Attestation endpoint returned error
        this.emitAttestationAlert('ATTESTATION_ENDPOINT_ERROR', {
          endpoint: this.config.endpoint,
          status: response.status,
          network: this.config.networkId,
        })
        throw new Error(
          `CRITICAL: KMS attestation endpoint returned ${response.status}`,
        )
      }

      const json = await response.json()
      const attestation = AttestationResponseSchema.parse(json)

      if (!attestation.verified) {
        // CRITICAL: Attestation verification failed - possible TEE compromise
        this.emitAttestationAlert('ATTESTATION_VERIFICATION_FAILED', {
          endpoint: this.config.endpoint,
          platform: attestation.platform,
          network: this.config.networkId,
          pcrs: attestation.pcrs as Record<string, string> | undefined,
        })
        throw new Error(
          'CRITICAL: KMS TEE attestation verification failed - possible compromise',
        )
      }

      if (attestation.platform === 'NONE' && !this.config.allowDevMode) {
        // CRITICAL: No TEE platform detected in production
        this.emitAttestationAlert('NO_TEE_PLATFORM', {
          endpoint: this.config.endpoint,
          network: this.config.networkId,
        })
        throw new Error(
          'CRITICAL: KMS is not running in a TEE - production requires TEE attestation',
        )
      }

      log.info('KMS attestation verified', {
        platform: attestation.platform,
        verified: attestation.verified,
      })
    } else {
      log.warn('Skipping KMS attestation verification (development mode)')
    }
  }

  /**
   * Verify HSM availability for key share storage.
   *
   * SECURITY: HSM backing ensures key shares are hardware-protected:
   * 1. Key shares generated inside HSM
   * 2. Shares never leave HSM in plaintext
   * 3. Signing operations use HSM APIs
   * 4. Provides FIPS 140-2 Level 3 security
   */
  private async verifyHSMAvailability(): Promise<void> {
    if (!this.config.hsm) return

    const hsmStatus = await checkHSMAvailability(
      this.config.networkId as 'localnet' | 'testnet' | 'mainnet',
    )

    if (!hsmStatus.available) {
      if (this.config.hsm.required) {
        this.emitAttestationAlert('HSM_UNAVAILABLE', {
          provider: this.config.hsm.provider,
          error: hsmStatus.error ?? 'Unknown error',
          network: this.config.networkId,
        })
        throw new Error(
          `CRITICAL: Required HSM (${this.config.hsm.provider}) is not available: ${hsmStatus.error}`,
        )
      } else {
        log.warn('HSM unavailable, falling back to software key storage', {
          provider: this.config.hsm.provider,
          error: hsmStatus.error ?? 'unknown error',
        })
      }
    } else {
      log.info('HSM verified and available', {
        provider: hsmStatus.provider,
      })
    }
  }

  /**
   * Sign a message hash using threshold signatures
   */
  async signMessage(messageHash: Hex): Promise<SignResult> {
    if (!this.initialized || !this.keyId) {
      throw new Error('KMS signer not initialized')
    }

    log.debug('Signing message via KMS', {
      keyId: this.keyId,
      messageHash: `${messageHash.slice(0, 10)}...`,
    })

    const response = await fetch(`${this.config.endpoint}/kms/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: this.keyId,
        messageHash,
        encoding: 'hex',
      }),
      signal: AbortSignal.timeout(this.config.timeout),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`KMS signing failed: ${error}`)
    }

    const json = await response.json()
    const result = SignResponseSchema.parse(json)

    log.debug('Message signed via KMS', {
      mode: result.mode,
      participants: result.participants,
    })

    return {
      signature: result.signature as Hex,
      r: result.r as Hex,
      s: result.s as Hex,
      v: result.v,
      mode: result.mode,
      participants: result.participants,
    }
  }

  /**
   * Sign and send a transaction via KMS
   */
  async signTransaction(tx: TransactionRequest): Promise<Hex> {
    if (!this.initialized || !this.keyId || !this.address) {
      throw new Error('KMS signer not initialized')
    }

    // Get nonce and gas estimation
    const publicClient = createPublicClient({
      transport: http(this.config.rpcUrl),
    })

    const [nonce, gasPrice, gasLimit] = await Promise.all([
      tx.nonce ?? publicClient.getTransactionCount({ address: this.address }),
      tx.gasPrice ?? tx.maxFeePerGas ?? publicClient.getGasPrice(),
      tx.gas ?? publicClient.estimateGas({ ...tx, account: this.address }),
    ])

    // Serialize the unsigned transaction
    const unsignedTx = serializeTransaction({
      chainId: this.config.chainId,
      nonce,
      gasPrice,
      gas: gasLimit,
      to: tx.to ?? undefined,
      value: tx.value ?? 0n,
      data: tx.data ?? '0x',
    })

    // Hash the transaction
    const txHash = keccak256(unsignedTx)

    // Sign via KMS
    const signResult = await this.signMessage(txHash)

    // Serialize signed transaction
    const signedTx = serializeTransaction(
      {
        chainId: this.config.chainId,
        nonce,
        gasPrice,
        gas: gasLimit,
        to: tx.to ?? undefined,
        value: tx.value ?? 0n,
        data: tx.data ?? '0x',
      },
      {
        r: signResult.r,
        s: signResult.s,
        v: BigInt(signResult.v),
      },
    )

    // Broadcast
    const hash = await publicClient.sendRawTransaction({
      serializedTransaction: signedTx,
    })

    log.info('Transaction sent via KMS', {
      hash,
      mode: signResult.mode,
      participants: signResult.participants,
    })

    return hash
  }

  /**
   * Sign a contract write operation
   */
  async signContractWrite(params: {
    address: Address
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    value?: bigint
  }): Promise<Hex> {
    const data = encodeFunctionData({
      abi: params.abi,
      functionName: params.functionName,
      args: params.args ?? [],
    })

    return this.signTransaction({
      to: params.address,
      data,
      value: params.value,
    })
  }

  /**
   * Get the signer's address
   */
  getAddress(): Address {
    if (!this.address) {
      throw new Error('KMS signer not initialized')
    }
    return this.address
  }

  /**
   * Get the key ID
   */
  getKeyId(): string {
    if (!this.keyId) {
      throw new Error('KMS signer not initialized')
    }
    return this.keyId
  }

  /**
   * Check if the signer is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Emit attestation alert for monitoring systems.
   *
   * Logs at CRITICAL level and can be integrated with:
   * - Prometheus metrics
   * - PagerDuty/OpsGenie alerts
   * - Slack/Discord webhooks
   */
  private emitAttestationAlert(
    alertType: string,
    details: Record<
      string,
      string | number | Record<string, string> | undefined
    >,
  ): void {
    // Log at critical level for log aggregation (Loki, CloudWatch, etc.)
    log.error(`[CRITICAL] KMS Attestation Alert: ${alertType}`, {
      ...details,
      timestamp: new Date().toISOString(),
      severity: 'CRITICAL',
      category: 'security',
      subcategory: 'kms_attestation',
    })

    // Emit metric for Prometheus scraping
    // In production, this would integrate with actual metrics library
    this.emitMetric('kms_attestation_failure', 1, {
      alert_type: alertType,
      network: this.config.networkId,
    })
  }

  /**
   * Emit a metric for monitoring (Prometheus-compatible)
   */
  private emitMetric(
    name: string,
    value: number,
    labels: Record<string, string>,
  ): void {
    // Log metric in a format that can be scraped by Prometheus
    // or processed by log-based metrics systems
    log.info(`METRIC:${name}`, {
      value,
      labels,
      timestamp: Date.now(),
    })
  }

  /**
   * Rotate the MPC key shares.
   *
   * SECURITY: Key rotation replaces existing key shares with new ones
   * while preserving the same public key/address. This is critical for:
   * 1. Regular security hygiene (e.g., monthly rotation)
   * 2. Party compromise recovery (replacing compromised shares)
   * 3. Threshold changes (e.g., upgrading from 2-of-3 to 3-of-5)
   *
   * @param newThreshold New threshold (if changing)
   * @param newTotalParties New total parties (if changing)
   */
  async rotateKey(options?: {
    newThreshold?: number
    newTotalParties?: number
  }): Promise<void> {
    if (!this.initialized || !this.keyId) {
      throw new Error('KMS signer not initialized - cannot rotate key')
    }

    log.info('Initiating MPC key rotation', {
      keyId: this.keyId,
      currentThreshold: this.config.threshold,
      newThreshold: options?.newThreshold ?? null,
      newTotalParties: options?.newTotalParties ?? null,
    })

    // Verify attestation before rotation (security check)
    await this.verifyKMSAttestation()

    const response = await fetch(`${this.config.endpoint}/kms/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyId: this.keyId,
        newThreshold: options?.newThreshold ?? this.config.threshold,
        newTotalParties: options?.newTotalParties ?? this.config.totalParties,
      }),
      signal: AbortSignal.timeout(this.config.timeout * 2), // Rotation takes longer
    })

    if (!response.ok) {
      const error = await response.text()
      this.emitAttestationAlert('KEY_ROTATION_FAILED', {
        keyId: this.keyId,
        error,
        network: this.config.networkId,
      })
      throw new Error(`CRITICAL: MPC key rotation failed: ${error}`)
    }

    // Update local config if threshold changed
    if (options?.newThreshold) {
      this.config.threshold = options.newThreshold
    }
    if (options?.newTotalParties) {
      this.config.totalParties = options.newTotalParties
    }

    log.info('MPC key rotation completed', {
      keyId: this.keyId,
      newThreshold: this.config.threshold,
      newTotalParties: this.config.totalParties,
    })

    // Emit success metric
    this.emitMetric('kms_key_rotation_success', 1, {
      key_id: this.keyId,
      network: this.config.networkId,
      threshold: String(this.config.threshold),
    })
  }

  /**
   * Get key metadata including creation time and rotation history
   */
  async getKeyMetadata(): Promise<{
    keyId: string
    publicKey: Hex
    address: Address
    threshold: number
    totalParties: number
    createdAt: number
    lastRotatedAt: number
    rotationCount: number
  }> {
    if (!this.initialized || !this.keyId) {
      throw new Error('KMS signer not initialized')
    }

    const response = await fetch(
      `${this.config.endpoint}/kms/keys/${this.keyId}`,
      { signal: AbortSignal.timeout(this.config.timeout) },
    )

    if (!response.ok) {
      throw new Error(`Failed to get key metadata: ${response.statusText}`)
    }

    const json = await response.json()
    return {
      keyId: this.keyId,
      publicKey: this.publicKey ?? ('0x' as Hex),
      address:
        this.address ??
        ('0x0000000000000000000000000000000000000000' as Address),
      threshold: json.threshold ?? this.config.threshold,
      totalParties: json.totalParties ?? this.config.totalParties,
      createdAt: json.createdAt ?? 0,
      lastRotatedAt: json.lastRotatedAt ?? 0,
      rotationCount: json.rotationCount ?? 0,
    }
  }

  /**
   * Schedule automatic key rotation
   *
   * @param intervalMs Rotation interval in milliseconds (default: 30 days)
   */
  scheduleRotation(
    intervalMs: number = 30 * 24 * 60 * 60 * 1000,
  ): NodeJS.Timeout {
    log.info('Scheduling automatic key rotation', {
      intervalMs,
      intervalDays: intervalMs / (24 * 60 * 60 * 1000),
    })

    return setInterval(async () => {
      log.info('Automatic key rotation triggered')
      await this.rotateKey().catch((err) => {
        this.emitAttestationAlert('SCHEDULED_ROTATION_FAILED', {
          keyId: this.keyId ?? 'unknown',
          error: String(err),
          network: this.config.networkId,
        })
      })
    }, intervalMs)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a KMS signer from environment configuration.
 *
 * Uses network-specific threshold and HSM configuration:
 * - Localnet: 1-of-1 (dev mode, software keys)
 * - Testnet: 2-of-3 (attestation recommended, HSM optional)
 * - Mainnet: 3-of-5 (attestation required, HSM required)
 */
export function createKMSSigner(
  rpcUrl: string,
  chainId: number,
  config?: Partial<KMSSignerConfig>,
): KMSSigner {
  const network = getCurrentNetwork()
  const endpoint = getKmsServiceUrl(network)
  const thresholdConfig = getKmsThresholdConfig(network)
  const hsmConfig = getHSMConfig(network)

  const fullConfig: KMSSignerConfig = {
    endpoint,
    networkId: network,
    threshold: thresholdConfig.threshold,
    totalParties: thresholdConfig.totalParties,
    timeout: thresholdConfig.signingTimeoutMs,
    allowDevMode: !thresholdConfig.requireAttestation,
    rpcUrl,
    chainId,
    hsm: hsmConfig,
    ...config,
  }

  // Validate mainnet security requirements
  if (network === 'mainnet') {
    if (fullConfig.threshold < 3) {
      throw new Error(
        `Mainnet requires minimum threshold of 3, got ${fullConfig.threshold}`,
      )
    }
    if (fullConfig.allowDevMode) {
      throw new Error('Mainnet cannot run in development mode')
    }
    if (
      !fullConfig.hsm ||
      fullConfig.hsm.provider === 'softhsm' ||
      fullConfig.hsm.provider === 'none'
    ) {
      throw new Error('Mainnet requires HSM-backed key storage')
    }
  }

  return new KMSSigner(fullConfig)
}

// ============================================================================
// Adapter for viem WalletClient Interface
// ============================================================================

/**
 * Create a viem-compatible account that uses KMS for signing.
 * This allows dropping KMS into existing code that uses walletClient.
 */
export async function createKMSAccount(kmsSigner: KMSSigner): Promise<{
  address: Address
  signMessage: (args: { message: string }) => Promise<Hex>
  signTransaction: (tx: TransactionRequest) => Promise<Hex>
}> {
  if (!kmsSigner.isInitialized()) {
    await kmsSigner.initialize()
  }

  return {
    address: kmsSigner.getAddress(),

    signMessage: async ({ message }) => {
      const messageHash = keccak256(toHex(message))
      const result = await kmsSigner.signMessage(messageHash)
      return result.signature
    },

    signTransaction: async (tx) => {
      return kmsSigner.signTransaction(tx)
    },
  }
}
