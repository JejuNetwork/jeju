/**
 * Node App Configuration
 * Centralized config injection for workerd compatibility
 */

import {
  createAppConfig,
  getEnvVar,
  getLocalhostHost,
  getRpcUrl,
  isProductionEnv,
} from '@jejunetwork/config'

export interface NodeConfig {
  // Network
  rpcUrl: string
  network: 'mainnet' | 'testnet' | 'localnet'

  // Wallet
  privateKey?: string
  jejuPrivateKey?: string
  evmPrivateKey?: string
  solanaPrivateKey?: string

  // Services
  proxyRegion: string
  dwsExecUrl: string
  seedingOracleUrl?: string
  externalIp?: string

  // RPC URLs
  rpcUrl1?: string // Ethereum
  rpcUrl42161?: string // Arbitrum
  rpcUrl10?: string // Optimism
  rpcUrl8453?: string // Base
  solanaRpcUrl?: string

  // Bridge
  zkBridgeEndpoint?: string
  zkProverEndpoint?: string
  oneInchApiKey?: string

  // Environment
  isProduction: boolean
}

const { config, configure: setNodeConfig } = createAppConfig<NodeConfig>({
  rpcUrl: getEnvVar('RPC_URL') ?? getRpcUrl('testnet'),
  network: (getEnvVar('JEJU_NETWORK') ?? 'testnet') as
    | 'mainnet'
    | 'testnet'
    | 'localnet',
  privateKey: getEnvVar('PRIVATE_KEY'),
  jejuPrivateKey: getEnvVar('JEJU_PRIVATE_KEY'),
  evmPrivateKey: getEnvVar('EVM_PRIVATE_KEY'),
  solanaPrivateKey: getEnvVar('SOLANA_PRIVATE_KEY'),
  proxyRegion: getEnvVar('PROXY_REGION') ?? 'GLOBAL',
  dwsExecUrl:
    getEnvVar('DWS_EXEC_URL') ?? `http://${getLocalhostHost()}:4020/exec`,
  seedingOracleUrl: getEnvVar('SEEDING_ORACLE_URL'),
  externalIp: getEnvVar('EXTERNAL_IP'),
  rpcUrl1: getEnvVar('RPC_URL_1'),
  rpcUrl42161: getEnvVar('RPC_URL_42161'),
  rpcUrl10: getEnvVar('RPC_URL_10'),
  rpcUrl8453: getEnvVar('RPC_URL_8453'),
  solanaRpcUrl: getEnvVar('SOLANA_RPC_URL'),
  zkBridgeEndpoint: getEnvVar('ZK_BRIDGE_ENDPOINT'),
  zkProverEndpoint: getEnvVar('ZK_PROVER_ENDPOINT'),
  oneInchApiKey: getEnvVar('ONEINCH_API_KEY'),
  isProduction: isProductionEnv(),
})

export { config }

export function configureNode(updates: Partial<NodeConfig>): void {
  setNodeConfig(updates)
}
