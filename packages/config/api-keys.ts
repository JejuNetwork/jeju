/**
 * @fileoverview Consolidated API Key Management
 * @module config/api-keys
 *
 * All API keys are OPTIONAL. Features gracefully degrade when keys are missing.
 *
 * @example
 * ```ts
 * import { getApiKey, hasApiKey, ApiKeyStatus } from '@jejunetwork/config/api-keys';
 *
 * // Get a key (returns undefined if not set)
 * const key = await getApiKey('etherscan');
 *
 * // Check if key exists
 * if (hasApiKey('walletconnect')) {
 *   // Enable wallet connect features
 * }
 *
 * // Get all configured keys status
 * const status = await getApiKeyStatus();
 * ```
 */

import { getSecret, type SecretName } from './secrets'

// ============================================================================
// Types
// ============================================================================

export interface ApiKeyConfig {
  envName: SecretName
  description: string
  usedFor: string[]
  required: false // All API keys are optional
  docsUrl?: string
  fallback?: string // Behavior when missing
}

export interface ApiKeyStatus {
  name: string
  configured: boolean
  description: string
  usedFor: string[]
}

// ============================================================================
// API Key Registry
// ============================================================================

const API_KEY_REGISTRY: Record<string, ApiKeyConfig> = {
  // Block Explorer Verification
  etherscan: {
    envName: 'ETHERSCAN_API_KEY',
    description: 'Etherscan API key for contract verification on Ethereum',
    usedFor: ['Contract verification on Ethereum mainnet/Sepolia'],
    required: false,
    docsUrl:
      'https://docs.etherscan.io/getting-started/viewing-api-usage-statistics',
    fallback: 'Contract verification skipped',
  },
  basescan: {
    envName: 'BASESCAN_API_KEY',
    description: 'Basescan API key for contract verification on Base',
    usedFor: ['Contract verification on Base mainnet/Sepolia'],
    required: false,
    docsUrl: 'https://docs.basescan.org/getting-started',
    fallback: 'Contract verification skipped',
  },
  arbiscan: {
    envName: 'ARBISCAN_API_KEY',
    description: 'Arbiscan API key for contract verification on Arbitrum',
    usedFor: ['Contract verification on Arbitrum One/Sepolia'],
    required: false,
    docsUrl: 'https://docs.arbiscan.io/getting-started',
    fallback: 'Contract verification skipped',
  },
  opscan: {
    envName: 'OPSCAN_API_KEY',
    description: 'OP Etherscan API key for contract verification on Optimism',
    usedFor: ['Contract verification on OP Mainnet/Sepolia'],
    required: false,
    docsUrl: 'https://docs.optimism.io/developers/tools',
    fallback: 'Contract verification skipped',
  },

  // Frontend
  walletconnect: {
    envName: 'WALLETCONNECT_PROJECT_ID',
    description: 'WalletConnect Cloud project ID for wallet connections',
    usedFor: ['Wallet connections in Gateway, Bazaar, and other frontends'],
    required: false,
    docsUrl: 'https://cloud.walletconnect.com/',
    fallback: 'Wallet connection options limited to injected wallets',
  },

  // Storage
  pinata: {
    envName: 'PINATA_JWT',
    description: 'Pinata JWT for IPFS pinning',
    usedFor: ['Pinning agent metadata, NFT assets to IPFS'],
    required: false,
    docsUrl: 'https://docs.pinata.cloud/docs/getting-started',
    fallback: 'Uses local IPFS node or public gateways',
  },

  // Social
  neynar: {
    envName: 'NEYNAR_API_KEY',
    description: 'Neynar API key for Farcaster integration',
    usedFor: ['Farcaster authentication in OAuth3', 'Social features'],
    required: false,
    docsUrl: 'https://docs.neynar.com/docs/getting-started',
    fallback: 'Uses permissionless Farcaster Hub access (slower)',
  },

  // AI/ML
  openrouter: {
    envName: 'OPENROUTER_API_KEY',
    description: 'OpenRouter API key for AI model access',
    usedFor: [
      'Leaderboard AI evaluation',
      'Agent assessment',
      'AI features in Gateway',
    ],
    required: false,
    docsUrl: 'https://openrouter.ai/docs',
    fallback: 'AI features disabled',
  },
  openai: {
    envName: 'OPENAI_API_KEY',
    description: 'OpenAI API key for GPT models',
    usedFor: ['Direct OpenAI model access in agents'],
    required: false,
    docsUrl: 'https://platform.openai.com/docs/quickstart',
    fallback: 'Falls back to OpenRouter or local models',
  },
  anthropic: {
    envName: 'ANTHROPIC_API_KEY',
    description: 'Anthropic API key for Claude models',
    usedFor: ['Direct Claude model access in agents'],
    required: false,
    docsUrl: 'https://docs.anthropic.com/en/docs/getting-access-to-claude',
    fallback: 'Falls back to OpenRouter or local models',
  },

  // Enhanced RPC
  alchemy: {
    envName: 'ALCHEMY_API_KEY',
    description: 'Alchemy API key for enhanced RPC',
    usedFor: [
      'Enhanced RPC endpoints',
      'Solver operations',
      'Reliable transactions',
    ],
    required: false,
    docsUrl: 'https://docs.alchemy.com/docs/alchemy-quickstart-guide',
    fallback: 'Uses public RPC endpoints from config',
  },

  // Infrastructure
  cloudflare: {
    envName: 'CLOUDFLARE_API_TOKEN',
    description: 'Cloudflare API token for DNS management',
    usedFor: ['DNS record updates', 'SSL certificate management'],
    required: false,
    docsUrl: 'https://developers.cloudflare.com/api/tokens/',
    fallback: 'Manual DNS configuration required',
  },

  // ZK Proving
  succinct: {
    envName: 'SUCCINCT_API_KEY',
    description: 'Succinct API key for remote ZK proving',
    usedFor: ['SP1 proof generation for NFT bridge', 'EVM light client proofs'],
    required: false,
    docsUrl: 'https://docs.succinct.xyz/',
    fallback: 'Uses local SP1 proving (slower, requires sp1up)',
  },

  // TEE
  phala: {
    envName: 'PHALA_API_KEY',
    description: 'Phala API key for TEE infrastructure',
    usedFor: [
      'Trusted execution environment operations',
      'Secure key management',
    ],
    required: false,
    docsUrl: 'https://docs.phala.network/',
    fallback: 'Uses local TEE simulation or AWS Nitro',
  },

  // DEX
  oneinch: {
    envName: 'ONEINCH_API_KEY',
    description: '1inch API key for DEX aggregation',
    usedFor: ['Arbitrage detection', 'Price comparison', 'Route optimization'],
    required: false,
    docsUrl: 'https://docs.1inch.io/docs/aggregation-protocol/introduction',
    fallback: 'Uses on-chain routing only',
  },
}

// ============================================================================
// API Key Access
// ============================================================================

export type ApiKeyName = keyof typeof API_KEY_REGISTRY

/**
 * Get an API key by name
 */
export async function getApiKey(name: ApiKeyName): Promise<string | undefined> {
  const config = API_KEY_REGISTRY[name]
  if (!config) return undefined
  return getSecret(config.envName)
}

/**
 * Get an API key synchronously (env only, no cloud lookup)
 */
export function getApiKeySync(name: ApiKeyName): string | undefined {
  const config = API_KEY_REGISTRY[name]
  if (!config) return undefined
  return process.env[config.envName]
}

/**
 * Check if an API key is configured
 */
export function hasApiKey(name: ApiKeyName): boolean {
  const config = API_KEY_REGISTRY[name]
  if (!config) return false
  return Boolean(process.env[config.envName])
}

/**
 * Get the configuration for an API key
 */
export function getApiKeyConfig(name: ApiKeyName): ApiKeyConfig | undefined {
  return API_KEY_REGISTRY[name]
}

/**
 * Get status of all API keys
 */
export async function getApiKeyStatus(): Promise<ApiKeyStatus[]> {
  const status: ApiKeyStatus[] = []

  for (const [name, config] of Object.entries(API_KEY_REGISTRY)) {
    const value = await getSecret(config.envName)
    status.push({
      name,
      configured: Boolean(value),
      description: config.description,
      usedFor: config.usedFor,
    })
  }

  return status
}

/**
 * Print API key status to console
 */
export async function printApiKeyStatus(): Promise<void> {
  const status = await getApiKeyStatus()

  console.log('\n📋 API Key Status\n')
  console.log('─'.repeat(80))

  const configured = status.filter((s) => s.configured)
  const missing = status.filter((s) => !s.configured)

  if (configured.length > 0) {
    console.log('\n✅ Configured:')
    for (const s of configured) {
      console.log(`   ${s.name.padEnd(15)} - ${s.description}`)
    }
  }

  if (missing.length > 0) {
    console.log('\n⚠️  Not configured (optional):')
    for (const s of missing) {
      const config = API_KEY_REGISTRY[s.name as ApiKeyName]
      console.log(`   ${s.name.padEnd(15)} - ${s.description}`)
      if (config?.fallback) {
        console.log(`                    └─ Fallback: ${config.fallback}`)
      }
    }
  }

  console.log(`\n${'─'.repeat(80)}`)
  console.log(`Total: ${configured.length}/${status.length} configured`)
  console.log('All API keys are optional. Features degrade gracefully.\n')
}

// ============================================================================
// Block Explorer Keys (Common Pattern)
// ============================================================================

export interface BlockExplorerKeys {
  ethereum?: string
  base?: string
  arbitrum?: string
  optimism?: string
}

/**
 * Get all block explorer API keys
 */
export async function getBlockExplorerKeys(): Promise<BlockExplorerKeys> {
  return {
    ethereum: await getApiKey('etherscan'),
    base: await getApiKey('basescan'),
    arbitrum: await getApiKey('arbiscan'),
    optimism: await getApiKey('opscan'),
  }
}

/**
 * Get the explorer API key for a given chain ID
 */
export async function getExplorerKeyForChain(
  chainId: number,
): Promise<string | undefined> {
  const chainToExplorer: Record<number, ApiKeyName> = {
    1: 'etherscan', // Ethereum mainnet
    11155111: 'etherscan', // Sepolia
    8453: 'basescan', // Base mainnet
    84532: 'basescan', // Base Sepolia
    42161: 'arbiscan', // Arbitrum One
    421614: 'arbiscan', // Arbitrum Sepolia
    10: 'opscan', // OP Mainnet
    11155420: 'opscan', // OP Sepolia
  }

  const explorerName = chainToExplorer[chainId]
  if (!explorerName) return undefined
  return getApiKey(explorerName)
}

// ============================================================================
// AI Keys (Common Pattern)
// ============================================================================

export interface AIProviderKeys {
  openrouter?: string
  openai?: string
  anthropic?: string
}

/**
 * Get all AI provider API keys
 */
export async function getAIProviderKeys(): Promise<AIProviderKeys> {
  return {
    openrouter: await getApiKey('openrouter'),
    openai: await getApiKey('openai'),
    anthropic: await getApiKey('anthropic'),
  }
}

/**
 * Check if any AI provider is configured
 */
export function hasAnyAIProvider(): boolean {
  return (
    hasApiKey('openrouter') || hasApiKey('openai') || hasApiKey('anthropic')
  )
}

// ============================================================================
// Documentation Helper
// ============================================================================

/**
 * Generate documentation for all API keys
 */
export function generateApiKeyDocs(): string {
  let docs = '# API Keys Reference\n\n'
  docs +=
    'All API keys are **optional**. Features degrade gracefully when keys are missing.\n\n'

  const categories = {
    'Block Explorer Verification': [
      'etherscan',
      'basescan',
      'arbiscan',
      'opscan',
    ],
    Frontend: ['walletconnect'],
    Storage: ['pinata'],
    Social: ['neynar'],
    'AI/ML': ['openrouter', 'openai', 'anthropic'],
    'Enhanced RPC': ['alchemy'],
    Infrastructure: ['cloudflare'],
    'ZK Proving': ['succinct'],
    TEE: ['phala'],
    DEX: ['oneinch'],
  }

  for (const [category, keys] of Object.entries(categories)) {
    docs += `## ${category}\n\n`

    for (const key of keys) {
      const config = API_KEY_REGISTRY[key as ApiKeyName]
      if (!config) continue

      docs += `### ${config.envName}\n\n`
      docs += `${config.description}\n\n`
      docs += `**Used for:** ${config.usedFor.join(', ')}\n\n`
      if (config.fallback) {
        docs += `**Fallback:** ${config.fallback}\n\n`
      }
      if (config.docsUrl) {
        docs += `**Documentation:** ${config.docsUrl}\n\n`
      }
    }
  }

  return docs
}
