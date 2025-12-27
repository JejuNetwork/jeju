/**
 * Oracle Node Configuration
 *
 * SECURITY: This module no longer stores private keys.
 * All signing is delegated to the KMS service (MPC or TEE).
 * Uses KMS service IDs instead of raw private keys.
 */

import {
  ConfigurationError,
  type OracleConfigFileData,
  type OracleNetworkConfig,
  resolveEnvVar,
} from '@jejunetwork/shared'
import type { NetworkType, PriceSourceConfig } from '@jejunetwork/types'
import { expectAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, type Hex, isAddress } from 'viem'
import { config as gatewayConfig } from '../config'
import type { SecureOracleNodeConfig } from './node'

// Local type aliases for convenience
type NetworkConfig = OracleNetworkConfig
type ConfigFileData = OracleConfigFileData

const REQUIRED_ADDRESSES = [
  'feedRegistry',
  'reportVerifier',
  'committeeManager',
  'feeRouter',
  'networkConnector',
] as const

// Use shared utilities, but keep local validateAddress for stricter checking
function validateAddressLocal(addr: string | null, name: string): Address {
  if (!addr || addr === ZERO_ADDRESS) {
    throw new ConfigurationError(`${name} address not configured`)
  }
  if (!isAddress(addr)) {
    throw new ConfigurationError(`${name} is not a valid address: ${addr}`)
  }
  return addr
}

export async function loadNetworkConfig(
  network: NetworkType,
): Promise<NetworkConfig> {
  const configPath = new URL(
    '../../../../packages/config/oracle/networks.json',
    import.meta.url,
  )
  const configFile = Bun.file(configPath)

  if (!(await configFile.exists())) {
    throw new ConfigurationError(`Network config file not found: ${configPath}`)
  }

  const config: ConfigFileData = await configFile.json()
  const networkConfig = config[network]

  if (!networkConfig) {
    throw new ConfigurationError(`Unknown network: ${network}`)
  }

  networkConfig.rpcUrl = resolveEnvVar(networkConfig.rpcUrl)

  return networkConfig
}

export function loadContractAddresses(
  networkConfig: NetworkConfig,
): Record<string, Address> {
  const addresses: Record<string, Address> = {}

  const envOverrides: Record<string, string | undefined> = {
    feedRegistry: gatewayConfig.feedRegistryAddress,
    reportVerifier: gatewayConfig.reportVerifierAddress,
    committeeManager: gatewayConfig.committeeManagerAddress,
    feeRouter: gatewayConfig.feeRouterAddress,
    networkConnector: gatewayConfig.networkConnectorAddress,
  }

  for (const key of REQUIRED_ADDRESSES) {
    const envAddr = envOverrides[key]
    const configAddr = networkConfig.contracts[key]
    const addr = envAddr ?? configAddr

    addresses[key] = validateAddressLocal(addr, key)
  }

  return addresses
}

export function buildPriceSources(
  networkConfig: NetworkConfig,
  feedIdMap: Map<string, Hex>,
): PriceSourceConfig[] {
  const sources: PriceSourceConfig[] = []

  for (const [symbol, sourceConfig] of Object.entries(
    networkConfig.priceSources,
  )) {
    const feedId = feedIdMap.get(symbol)
    if (!feedId) continue

    sources.push({
      type: sourceConfig.type,
      address: sourceConfig.address
        ? expectAddress(sourceConfig.address)
        : ZERO_ADDRESS,
      feedId,
      decimals: sourceConfig.decimals,
    })
  }

  return sources
}

/**
 * Create a secure oracle node configuration.
 *
 * SECURITY: Uses KMS service IDs instead of private keys.
 * The actual keys are managed by the KMS service (MPC or TEE).
 */
export function createConfig(
  network: NetworkType = 'localnet',
): Promise<SecureOracleNodeConfig> {
  return createConfigAsync(network)
}

async function createConfigAsync(
  network: NetworkType,
): Promise<SecureOracleNodeConfig> {
  console.log(`[Config] Loading configuration for network: ${network}`)

  const networkConfig = await loadNetworkConfig(network)
  const addresses = loadContractAddresses(networkConfig)

  console.log(
    `[Config] Network: ${network} (chainId: ${networkConfig.chainId})`,
  )
  console.log(`[Config] RPC: ${networkConfig.rpcUrl}`)
  console.log(`[Config] Contracts loaded: ${Object.keys(addresses).join(', ')}`)

  return {
    rpcUrl: networkConfig.rpcUrl,
    chainId: networkConfig.chainId,
    // SECURITY: Use KMS service IDs instead of private keys
    operatorServiceId:
      process.env.ORACLE_OPERATOR_SERVICE_ID ?? 'oracle-operator',
    workerServiceId: process.env.ORACLE_WORKER_SERVICE_ID ?? 'oracle-worker',
    feedRegistry: addresses.feedRegistry,
    reportVerifier: addresses.reportVerifier,
    committeeManager: addresses.committeeManager,
    feeRouter: addresses.feeRouter,
    networkConnector: addresses.networkConnector,
    pollIntervalMs: networkConfig.settings.pollIntervalMs,
    heartbeatIntervalMs: networkConfig.settings.heartbeatIntervalMs,
    metricsPort: networkConfig.settings.metricsPort,
    priceSources: [],
  }
}

export function validateConfig(config: SecureOracleNodeConfig): void {
  const errors: string[] = []

  if (!config.rpcUrl) {
    errors.push('RPC URL is required')
  }

  if (config.chainId <= 0) {
    errors.push('Chain ID must be positive')
  }

  if (config.pollIntervalMs < 1000) {
    errors.push('Poll interval must be at least 1 second')
  }

  if (config.heartbeatIntervalMs < config.pollIntervalMs) {
    errors.push('Heartbeat interval should be >= poll interval')
  }

  const zeroAddress = '0x0000000000000000000000000000000000000000'
  if (config.feedRegistry === zeroAddress) {
    errors.push('Feed registry address not configured')
  }
  if (config.reportVerifier === zeroAddress) {
    errors.push('Report verifier address not configured')
  }
  if (config.networkConnector === zeroAddress) {
    errors.push('Network connector address not configured')
  }

  if (errors.length > 0) {
    throw new ConfigurationError(
      `Invalid configuration:\n  - ${errors.join('\n  - ')}`,
    )
  }
}
