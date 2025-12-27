/**
 * X402 Facilitator Configuration
 *
 * SECURITY: This module no longer stores private keys.
 * All signing is delegated to the KMS service (MPC or TEE).
 * The facilitator service ID is used to identify the signer.
 */

import { getServiceName } from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'
import { getKMSSigner } from '../../../lib/kms-signer'
import { getPrimaryChainConfig } from '../lib/chains'
import { clearClientCache } from '../services/settler'

export interface FacilitatorConfig {
  port: number
  host: string
  environment: 'production' | 'development'
  chainId: number
  network: string
  rpcUrl: string
  facilitatorAddress: Address
  usdcAddress: Address
  /** @deprecated Use KMS service ID instead */
  privateKey: null
  protocolFeeBps: number
  feeRecipient: Address
  maxPaymentAge: number
  minAmount: bigint
  serviceName: string
  serviceVersion: string
  serviceUrl: string
  /** KMS service ID for signing (replaces private key) */
  kmsServiceId: string
}

function getEnvAddress(key: string, defaultValue: Address): Address {
  const value = process.env[key]
  if (!value || !value.startsWith('0x') || value.length !== 42)
    return defaultValue
  return value as Address // Validated above
}

export function getConfig(): FacilitatorConfig {
  const chainConfig = getPrimaryChainConfig()
  const port = parseInt(
    process.env.FACILITATOR_PORT ?? process.env.PORT ?? '3402',
    10,
  )

  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    environment:
      process.env.NODE_ENV === 'production' ? 'production' : 'development',
    chainId: chainConfig.chainId,
    network: chainConfig.network,
    rpcUrl: chainConfig.rpcUrl,
    facilitatorAddress: getEnvAddress(
      'X402_FACILITATOR_ADDRESS',
      chainConfig.facilitator,
    ),
    usdcAddress: getEnvAddress('JEJU_USDC_ADDRESS', chainConfig.usdc),
    // SECURITY: No private key - use KMS service ID
    privateKey: null,
    protocolFeeBps: parseInt(process.env.PROTOCOL_FEE_BPS ?? '50', 10),
    feeRecipient: getEnvAddress('FEE_RECIPIENT_ADDRESS', ZERO_ADDRESS),
    maxPaymentAge: parseInt(process.env.MAX_PAYMENT_AGE ?? '300', 10),
    minAmount: BigInt(process.env.MIN_PAYMENT_AMOUNT ?? '1'),
    serviceName: getServiceName('x402 Facilitator'),
    serviceVersion: '1.0.0',
    serviceUrl: process.env.FACILITATOR_URL ?? `http://localhost:${port}`,
    // KMS service ID for signing
    kmsServiceId:
      process.env.X402_FACILITATOR_SERVICE_ID ?? 'x402-facilitator',
  }
}

let configInstance: FacilitatorConfig | null = null

export function config(): FacilitatorConfig {
  if (!configInstance) configInstance = getConfig()
  return configInstance
}

export function resetConfig(): void {
  configInstance = null
  clearClientCache()
}

export function validateConfig(): { valid: boolean; errors: string[] } {
  const cfg = config()
  const errors: string[] = []

  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    errors.push('X402_FACILITATOR_ADDRESS not configured')
  }

  if (cfg.protocolFeeBps > 1000) {
    errors.push('Protocol fee cannot exceed 10%')
  }

  // Fee recipient must be configured in production to collect protocol fees
  if (cfg.environment === 'production' && cfg.feeRecipient === ZERO_ADDRESS) {
    errors.push(
      'FEE_RECIPIENT_ADDRESS must be configured in production to collect protocol fees',
    )
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Check if the KMS signer is available and properly configured.
 */
export async function isKMSAvailable(): Promise<boolean> {
  const cfg = config()
  const signer = getKMSSigner(cfg.kmsServiceId)

  const health = await signer.checkHealth()
  return health.available
}

/**
 * Get the current configuration status.
 */
export async function getConfigStatus(): Promise<{
  environment: string
  kmsServiceId: string
  kmsAvailable: boolean
  signingMode: string
  facilitatorConfigured: boolean
}> {
  const cfg = config()
  const signer = getKMSSigner(cfg.kmsServiceId)
  const kmsAvailable = await isKMSAvailable()

  return {
    environment: cfg.environment,
    kmsServiceId: cfg.kmsServiceId,
    kmsAvailable,
    signingMode: signer.getMode(),
    facilitatorConfigured: cfg.facilitatorAddress !== ZERO_ADDRESS,
  }
}

/**
 * @deprecated Use KMS signer instead of direct private key access.
 * This function is kept for backwards compatibility but always returns null.
 */
export async function getPrivateKeyFromKMS(): Promise<null> {
  console.warn(
    '[X402 Config] getPrivateKeyFromKMS is deprecated. Use KMS signer via getKMSSigner(serviceId)',
  )
  return null
}

/**
 * @deprecated No longer needed as keys are not cached.
 */
export async function clearKMSKeyCache(): Promise<void> {
  // No-op - keys are no longer cached
  clearClientCache()
}
