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
import { config as gatewayConfig } from '../../config'
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
  protocolFeeBps: number
  feeRecipient: Address
  maxPaymentAge: number
  minAmount: bigint
  serviceName: string
  serviceVersion: string
  serviceUrl: string
  /** KMS service ID for signing */
  kmsServiceId: string
}

function getEnvAddress(
  configValue: string | undefined,
  defaultValue: Address,
): Address {
  if (
    !configValue ||
    !configValue.startsWith('0x') ||
    configValue.length !== 42
  )
    return defaultValue
  return configValue as Address
}

export function getConfig(): FacilitatorConfig {
  const chainConfig = getPrimaryChainConfig()
  const port = gatewayConfig.facilitatorPort

  return {
    port,
    host: gatewayConfig.host,
    environment: gatewayConfig.isProduction ? 'production' : 'development',
    chainId: chainConfig.chainId,
    network: chainConfig.network,
    rpcUrl: chainConfig.rpcUrl,
    facilitatorAddress: getEnvAddress(
      gatewayConfig.facilitatorAddress,
      chainConfig.facilitator,
    ),
    usdcAddress: getEnvAddress(gatewayConfig.usdcAddress, chainConfig.usdc),
    protocolFeeBps: gatewayConfig.protocolFeeBps,
    feeRecipient: getEnvAddress(
      gatewayConfig.feeRecipientAddress,
      ZERO_ADDRESS,
    ),
    maxPaymentAge: gatewayConfig.maxPaymentAge,
    minAmount: gatewayConfig.minPaymentAmount,
    serviceName: getServiceName('x402 Facilitator'),
    serviceVersion: '1.0.0',
    serviceUrl: gatewayConfig.facilitatorUrl,
    // KMS service ID for signing
    kmsServiceId: process.env.X402_FACILITATOR_SERVICE_ID ?? 'x402-facilitator',
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
