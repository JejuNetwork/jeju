/**
 * ThresholdSigner - Simple client for DWS-based MPC signing
 *
 * For application-level threshold signing via the DWS KMS API.
 * This is a simpler alternative to MPCSigningClient for apps
 * that just need to sign messages without managing MPC discovery.
 */

import type { JsonValue } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { isAddress, keccak256, toHex } from 'viem'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export interface ThresholdSignerConfig {
  endpoints: string[]
  networkId: string
  threshold: number
  timeout: number
  devMode?: boolean
}

export interface ThresholdSignResult {
  signature: Hex
  participants: string[]
}

// Response validation schemas
const SignResponseSchema = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  mode: z.enum(['mpc', 'development']),
})

const KeyGenResponseSchema = z.object({
  keyId: z.string(),
  publicKey: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/)
    .optional(),
})

// ============================================================================
// Default Config
// ============================================================================

export const DEFAULT_THRESHOLD_SIGNER_CONFIG: ThresholdSignerConfig = {
  endpoints: ['http://localhost:4200'],
  networkId: 'jeju-local',
  threshold: 2,
  timeout: 30000,
  devMode: true,
}

// ============================================================================
// ThresholdSigner Class
// ============================================================================

/**
 * Threshold Signer for MPC-based message signing.
 *
 * Connects to DWS KMS for actual MPC signing.
 * Simpler interface than MPCSigningClient for basic signing needs.
 */
export class ThresholdSigner {
  private readonly userId: Address
  private readonly config: ThresholdSignerConfig
  private initialized = false
  private keyId: string | null = null

  constructor(userId: string, config: ThresholdSignerConfig) {
    if (!isAddress(userId)) {
      throw new Error(
        `Invalid userId format: ${userId}. Must be a hex address.`,
      )
    }
    this.userId = userId
    this.config = config
  }

  /**
   * Initialize the signer by connecting to DWS and creating/retrieving an MPC key
   */
  async initialize(): Promise<void> {
    const endpoint = this.config.endpoints[0]
    if (!endpoint) {
      throw new Error('No MPC endpoint configured')
    }

    const response = await fetch(`${endpoint}/kms/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.userId,
      },
      body: JSON.stringify({
        threshold: this.config.threshold,
        totalParties: this.config.threshold + 2,
        metadata: { userId: this.userId },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(
        `Failed to initialize MPC key: ${error}. Ensure DWS is running at ${endpoint}`,
      )
    }

    const json = await response.json()
    const result = KeyGenResponseSchema.parse(json)
    this.keyId = result.keyId
    this.initialized = true
  }

  /**
   * Sign a message using threshold signatures via DWS KMS
   */
  async signMessage(message: string): Promise<ThresholdSignResult> {
    if (!this.initialized || !this.keyId) {
      throw new Error(
        'ThresholdSigner not initialized. Call initialize() first.',
      )
    }

    const endpoint = this.config.endpoints[0]
    const messageHash = keccak256(toHex(new TextEncoder().encode(message)))

    const response = await fetch(`${endpoint}/kms/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': this.userId,
      },
      body: JSON.stringify({
        keyId: this.keyId,
        messageHash,
        encoding: 'hex',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`MPC signing failed: ${error}`)
    }

    const json = await response.json()
    const result = SignResponseSchema.parse(json)

    return {
      signature: result.signature as Hex,
      participants: result.mode === 'mpc' ? ['mpc-cluster'] : ['dws-local'],
    }
  }

  /**
   * Sign typed data (EIP-712) via DWS KMS
   */
  async signTypedData(
    typedData: Record<string, JsonValue>,
  ): Promise<ThresholdSignResult> {
    const message = JSON.stringify(typedData)
    return this.signMessage(message)
  }

  /**
   * Get the signer's user ID
   */
  getUserId(): Address {
    return this.userId
  }

  /**
   * Check if the signer is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get the MPC key ID (after initialization)
   */
  getKeyId(): string | null {
    return this.keyId
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ThresholdSigner configured from environment
 */
export function createThresholdSigner(
  userId: string,
  config?: Partial<ThresholdSignerConfig>,
): ThresholdSigner {
  const endpoint = process.env.JEJU_KMS_SERVICE_URL ?? 'http://localhost:4200'
  const networkId = process.env.JEJU_NETWORK ?? 'localnet'
  const devMode = process.env.NODE_ENV !== 'production'

  const fullConfig: ThresholdSignerConfig = {
    endpoints: [endpoint],
    networkId,
    threshold: 2,
    timeout: 30000,
    devMode,
    ...config,
  }

  return new ThresholdSigner(userId, fullConfig)
}
