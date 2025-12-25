/**
 * Oracle Node Types
 * Shared types for oracle node implementations
 */

import type { Address, Hex } from 'viem'

/**
 * Network configuration for oracle node
 */
export interface OracleNetworkConfig {
  chainId: number
  rpcUrl: string
  contracts: {
    feedRegistry: string | null
    reportVerifier: string | null
    committeeManager: string | null
    feeRouter: string | null
    networkConnector: string | null
  }
  priceSources: Record<
    string,
    {
      type: 'uniswap_v3' | 'chainlink' | 'manual'
      address?: string
      decimals: number
      token0Decimals?: number
      token1Decimals?: number
    }
  >
  settings: {
    pollIntervalMs: number
    heartbeatIntervalMs: number
    metricsPort: number
  }
}

/**
 * Configuration file data structure
 */
export interface OracleConfigFileData {
  localnet: OracleNetworkConfig
  testnet: OracleNetworkConfig
  mainnet: OracleNetworkConfig
}

/**
 * Prometheus metric structure for metrics exporter
 */
export interface PrometheusMetric {
  name: string
  help: string
  type: 'gauge' | 'counter'
  labels: Record<string, string>
  value: number
}

/**
 * Configuration error class
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

/**
 * Resolve environment variable placeholders
 */
export function resolveEnvVar(value: string): string {
  if (value.startsWith('${') && value.endsWith('}')) {
    const envVar = value.slice(2, -1)
    const resolved = process.env[envVar]
    if (!resolved) {
      throw new ConfigurationError(\`Environment variable \${envVar} not set\`)
    }
    return resolved
  }
  return value
}

/**
 * Validate a private key (32-byte hex string)
 */
export function validatePrivateKey(key: string, name: string): Hex {
  if (!key || !key.startsWith('0x') || key.length !== 66) {
    throw new ConfigurationError(
      \`\${name} must be a valid 32-byte hex string (0x + 64 chars)\`,
    )
  }
  return key as Hex
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Validate an address (not zero)
 */
export function validateAddress(addr: string | null, name: string): Address {
  if (!addr || addr === ZERO_ADDRESS) {
    throw new ConfigurationError(\`\${name} is required and cannot be zero address\`)
  }
  return addr as Address
}
