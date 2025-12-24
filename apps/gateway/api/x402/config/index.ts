import { getSecretVault } from '@jejunetwork/kms'
import { getServiceName } from '@jejunetwork/shared'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
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

function getEnvAddress(key: string, defaultValue: Address): Address {
  const value = process.env[key]
  if (!value || !value.startsWith('0x') || value.length !== 42)
    return defaultValue
  return value as Address // Validated above
}

function getEnvPrivateKey(): Hex | null {
  const key = process.env.FACILITATOR_PRIVATE_KEY
  if (!key || !key.startsWith('0x') || key.length !== 66) return null
  return key as Hex // Validated above
}

export function getConfig(): FacilitatorConfig {
  const chainConfig = getPrimaryChainConfig()
  const port = parseInt(
    process.env.FACILITATOR_PORT || process.env.PORT || '3402',
    10,
  )
  const kmsEnabled =
    process.env.KMS_ENABLED === 'true' ||
    process.env.VAULT_ENCRYPTION_SECRET !== undefined

  return {
    port,
    host: process.env.HOST || '0.0.0.0',
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
    privateKey: getEnvPrivateKey(),
    protocolFeeBps: parseInt(process.env.PROTOCOL_FEE_BPS || '50', 10),
    feeRecipient: getEnvAddress('FEE_RECIPIENT_ADDRESS', ZERO_ADDRESS),
    maxPaymentAge: parseInt(process.env.MAX_PAYMENT_AGE || '300', 10),
    minAmount: BigInt(process.env.MIN_PAYMENT_AMOUNT || '1'),
    serviceName: getServiceName('x402 Facilitator'),
    serviceVersion: '1.0.0',
    serviceUrl: process.env.FACILITATOR_URL || `http://localhost:${port}`,
    kmsEnabled,
    kmsSecretId: process.env.FACILITATOR_KMS_SECRET_ID ?? null,
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
  if (cfg.facilitatorAddress === ZERO_ADDRESS)
    errors.push('X402_FACILITATOR_ADDRESS not configured')
  if (!cfg.privateKey && !cfg.kmsEnabled && cfg.environment === 'production') {
    errors.push('FACILITATOR_PRIVATE_KEY or KMS_ENABLED required in production')
  }
  if (cfg.protocolFeeBps > 1000) errors.push('Protocol fee cannot exceed 10%')
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

  const serviceAddress = process.env.FACILITATOR_SERVICE_ADDRESS as
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
