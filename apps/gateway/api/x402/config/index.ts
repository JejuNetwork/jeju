import { getSecretVault } from '@jejunetwork/kms'
import { getServiceName } from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
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
  privateKey: `0x${string}` | null
  protocolFeeBps: number
  feeRecipient: Address
  maxPaymentAge: number
  minAmount: bigint
  serviceName: string
  serviceVersion: string
  serviceUrl: string
  kmsEnabled: boolean
  kmsSecretId: string | null
}

function getEnvAddress(configValue: string | undefined, defaultValue: Address): Address {
  if (!configValue || !configValue.startsWith('0x') || configValue.length !== 42)
    return defaultValue
  return configValue as Address
}

function getEnvPrivateKey(): Hex | null {
  const key = gatewayConfig.facilitatorPrivateKey
  if (!key || !key.startsWith('0x') || key.length !== 66) return null
  return key as Hex
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
    privateKey: getEnvPrivateKey(),
    protocolFeeBps: gatewayConfig.protocolFeeBps,
    feeRecipient: getEnvAddress(gatewayConfig.feeRecipientAddress, ZERO_ADDRESS),
    maxPaymentAge: gatewayConfig.maxPaymentAge,
    minAmount: gatewayConfig.minPaymentAmount,
    serviceName: getServiceName('x402 Facilitator'),
    serviceVersion: '1.0.0',
    serviceUrl: gatewayConfig.facilitatorUrl,
    kmsEnabled: gatewayConfig.kmsEnabled,
    kmsSecretId: gatewayConfig.kmsSecretId ?? null,
  }
}

let configInstance: FacilitatorConfig | null = null

export function config(): FacilitatorConfig {
  if (!configInstance) configInstance = getConfig()
  return configInstance
}

export function resetConfig(): void {
  configInstance = null
  kmsKeyCache = null
}

export function validateConfig(): { valid: boolean; errors: string[] } {
  const cfg = config()
  const errors: string[] = []

  if (cfg.facilitatorAddress === ZERO_ADDRESS) {
    errors.push('X402_FACILITATOR_ADDRESS not configured')
  }

  if (!cfg.privateKey && !cfg.kmsEnabled && cfg.environment === 'production') {
    errors.push('FACILITATOR_PRIVATE_KEY or KMS_ENABLED required in production')
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

let kmsKeyCache: `0x${string}` | null = null
let kmsInitialized = false

export async function getPrivateKeyFromKMS(): Promise<`0x${string}` | null> {
  const cfg = config()

  if (kmsKeyCache) return kmsKeyCache
  if (!cfg.kmsEnabled) return null

  if (!cfg.kmsSecretId) {
    if (cfg.environment === 'production') {
      throw new Error(
        'KMS enabled but FACILITATOR_KMS_SECRET_ID not configured',
      )
    }
    return null
  }

  const serviceAddress = gatewayConfig.facilitatorServiceAddress as
    | Address
    | undefined
  if (!serviceAddress) {
    if (cfg.environment === 'production') {
      throw new Error(
        'KMS enabled but FACILITATOR_SERVICE_ADDRESS not configured',
      )
    }
    return null
  }

  if (!serviceAddress.startsWith('0x') || serviceAddress.length !== 42) {
    throw new Error(`Invalid FACILITATOR_SERVICE_ADDRESS: ${serviceAddress}`)
  }

  const vault = getSecretVault()

  if (!kmsInitialized) {
    await vault.initialize()
    kmsInitialized = true
  }

  const privateKey = await vault.getSecret(cfg.kmsSecretId, serviceAddress)

  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    throw new Error('Invalid private key format from KMS')
  }

  kmsKeyCache = privateKey as Hex
  return kmsKeyCache
}

export async function isKMSAvailable(): Promise<boolean> {
  const cfg = config()
  if (!cfg.kmsEnabled || !cfg.kmsSecretId) return false

  try {
    await getSecretVault().initialize()
    return true
  } catch {
    return false
  }
}

export async function clearKMSKeyCache(): Promise<void> {
  kmsKeyCache = null
  kmsInitialized = false
  clearClientCache()
}

export async function getConfigStatus(): Promise<{
  environment: string
  kmsEnabled: boolean
  kmsAvailable: boolean
  keySource: 'kms' | 'env' | 'none'
  facilitatorConfigured: boolean
}> {
  const cfg = config()
  const kmsAvailable = await isKMSAvailable()

  let keySource: 'kms' | 'env' | 'none' = 'none'
  if (kmsKeyCache) keySource = 'kms'
  else if (cfg.privateKey) keySource = 'env'

  return {
    environment: cfg.environment,
    kmsEnabled: cfg.kmsEnabled,
    kmsAvailable,
    keySource,
    facilitatorConfigured: cfg.facilitatorAddress !== ZERO_ADDRESS,
  }
}
