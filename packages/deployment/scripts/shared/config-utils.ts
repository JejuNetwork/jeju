/**
 * @fileoverview Config utilities for scripts
 * @module packages/deployment/scripts/shared/config-utils
 *
 * Provides easy access to the config system for deployment and utility scripts.
 *
 * @example
 * ```ts
 * import { getDeployConfig, getDeployerAccount } from './config-utils';
 *
 * const config = getDeployConfig('testnet');
 * const account = await getDeployerAccount();
 * ```
 */

import type { Account, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  type EILChainConfig,
  getConfig,
  getCurrentNetwork,
  getEILChains,
  getExternalRpc,
  type NetworkType,
} from '../../packages/config'
import { getExplorerKeyForChain } from '../../packages/config/api-keys'
import { getActiveProvider, requireSecret } from '../../packages/config/secrets'
import {
  getTestKeys,
  type KeyRole,
  testnetKeysExist,
} from '../../packages/config/test-keys'

// ============================================================================
// Script-Friendly Helpers
// ============================================================================

/**
 * Get network from CLI args or environment
 */
export function getNetworkFromArgs(): NetworkType {
  // Check CLI args first
  const networkArg = process.argv.find(
    (arg) => arg === 'localnet' || arg === 'testnet' || arg === 'mainnet',
  )
  if (networkArg) return networkArg as NetworkType

  // Check --network flag
  const networkFlagIndex = process.argv.indexOf('--network')
  if (networkFlagIndex !== -1 && process.argv[networkFlagIndex + 1]) {
    return process.argv[networkFlagIndex + 1] as NetworkType
  }

  // Check -n flag
  const nFlagIndex = process.argv.indexOf('-n')
  if (nFlagIndex !== -1 && process.argv[nFlagIndex + 1]) {
    return process.argv[nFlagIndex + 1] as NetworkType
  }

  // Fall back to environment
  return getCurrentNetwork()
}

/**
 * Get deployment configuration for a network
 */
export function getDeployConfig(network?: NetworkType) {
  const net = network ?? getNetworkFromArgs()
  const config = getConfig(net)

  return {
    network: net,
    chainId: config.chain.chainId,
    rpcUrl: config.services.rpc.l2,
    l1RpcUrl: config.services.rpc.l1,
    explorerUrl: config.services.explorer,
    contracts: config.contracts,
    services: config.services,
  }
}

/**
 * Get deployer account (private key → viem Account)
 */
export async function getDeployerAccount(
  network?: NetworkType,
): Promise<Account> {
  const net = network ?? getNetworkFromArgs()

  // For localnet, use test keys
  if (net === 'localnet') {
    const keys = getTestKeys('localnet')
    return privateKeyToAccount(keys.keys.deployer.privateKey as Hex)
  }

  // For testnet, check generated keys first, then env
  if (net === 'testnet' && testnetKeysExist()) {
    const keys = getTestKeys('testnet')
    return privateKeyToAccount(keys.keys.deployer.privateKey as Hex)
  }

  // Fall back to environment/secrets
  const privateKey = await requireSecret('DEPLOYER_PRIVATE_KEY')
  return privateKeyToAccount(privateKey as Hex)
}

/**
 * Get private key for a role
 */
export async function getPrivateKeyForRole(
  role: KeyRole,
  network?: NetworkType,
): Promise<Hex> {
  const net = network ?? getNetworkFromArgs()

  if (net === 'localnet' || (net === 'testnet' && testnetKeysExist())) {
    const keys = getTestKeys(net)
    return keys.keys[role].privateKey as Hex
  }

  // Fall back to environment for specific roles
  const envMapping: Partial<Record<KeyRole, string>> = {
    deployer: 'DEPLOYER_PRIVATE_KEY',
    sequencer: 'SEQUENCER_PRIVATE_KEY',
    batcher: 'BATCHER_PRIVATE_KEY',
    proposer: 'PROPOSER_PRIVATE_KEY',
    challenger: 'CHALLENGER_PRIVATE_KEY',
  }

  const envName = envMapping[role]
  if (!envName) {
    throw new Error(`No environment variable mapping for role: ${role}`)
  }

  return (await requireSecret(
    envName as Parameters<typeof requireSecret>[0],
  )) as Hex
}

/**
 * Get RPC URL with env override support
 */
export function getRpcUrl(chainId: number, network?: NetworkType): string {
  // Check env override first
  const envKey = `CHAIN_${chainId}_RPC_URL`
  const envOverride = process.env[envKey]
  if (envOverride) return envOverride

  const net = network ?? getNetworkFromArgs()
  const config = getConfig(net)

  // Check if it's the Jeju chain
  if (chainId === config.chain.chainId) {
    return config.services.rpc.l2
  }

  // Check external chains in EIL config
  const eilChains: Record<string, EILChainConfig> = getEILChains(net)
  for (const chain of Object.values(eilChains)) {
    if (chain.chainId === chainId) {
      return chain.rpcUrl
    }
  }

  // Check contracts.json external
  return getExternalRpc(chainIdToName(chainId)) || ''
}

/**
 * Map chain ID to name for external chain lookup
 */
function chainIdToName(chainId: number): string {
  const mapping: Record<number, string> = {
    11155111: 'sepolia',
    84532: 'baseSepolia',
    421614: 'arbitrumSepolia',
    11155420: 'optimismSepolia',
    97: 'bscTestnet',
    1: 'ethereum',
    8453: 'base',
    42161: 'arbitrum',
    10: 'optimism',
    56: 'bsc',
  }
  return mapping[chainId] ?? `chain-${chainId}`
}

/**
 * Get all chain IDs for current network type
 */
export function getChainIds(network?: NetworkType): number[] {
  const net = network ?? getNetworkFromArgs()
  const chains: Record<string, EILChainConfig> = getEILChains(net)
  return Object.values(chains).map((c) => c.chainId)
}

/**
 * Get explorer API key for a chain (for verification)
 */
export async function getVerificationKey(
  chainId: number,
): Promise<string | undefined> {
  return getExplorerKeyForChain(chainId)
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return Boolean(
    process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI,
  )
}

/**
 * Print config summary for scripts
 */
export function printDeploymentInfo(network?: NetworkType): void {
  const net = network ?? getNetworkFromArgs()
  const config = getDeployConfig(net)
  const provider = getActiveProvider()

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Deployment Configuration                                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

Network:     ${net}
Chain ID:    ${config.chainId}
RPC URL:     ${config.rpcUrl}
Explorer:    ${config.explorerUrl}
Secrets:     ${provider.toUpperCase()}
`)
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate deployment prerequisites
 */
export async function validateDeploymentPrereqs(
  network?: NetworkType,
): Promise<{
  valid: boolean
  errors: string[]
}> {
  const net = network ?? getNetworkFromArgs()
  const errors: string[] = []

  // Check deployer key
  try {
    await getDeployerAccount(net)
  } catch {
    errors.push(
      'Deployer key not found. Run: bun run scripts/keys/manager.ts generate',
    )
  }

  // Check RPC connectivity
  const config = getDeployConfig(net)
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    })
    if (!response.ok) {
      errors.push(`RPC not reachable: ${config.rpcUrl}`)
    }
  } catch {
    errors.push(`RPC not reachable: ${config.rpcUrl}`)
  }

  return { valid: errors.length === 0, errors }
}
