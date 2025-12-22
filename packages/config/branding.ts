/**
 * Branding Configuration
 *
 * Centralized branding for the entire network.
 * Fork this and edit branding.json to customize your network.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type BrandingConfig,
  BrandingConfigSchema,
  type ChainBranding,
  type CliBranding,
  type FeaturesBranding,
  type LegalBranding,
  type SupportBranding,
  type TokenBranding,
  type UrlsBranding,
  type VisualBranding,
} from './schemas'

export type {
  BrandingConfig,
  ChainBranding,
  TokenBranding,
  UrlsBranding,
  VisualBranding,
  FeaturesBranding,
  LegalBranding,
  SupportBranding,
  CliBranding,
}

// ============================================================================
// Default Config (for documentation/template purposes)
// ============================================================================

/** Template for branding.json - exported for reference/testing */
export const DEFAULT_BRANDING: BrandingConfig = {
  version: '1.0.0',
  network: {
    name: 'MyNetwork',
    displayName: 'My Network',
    tagline: 'A modern EVM L2 network',
    description: 'A decentralized L2 network built on the OP Stack.',
    shortDescription: 'L2 network',
    keywords: ['L2', 'EVM', 'OP Stack', 'blockchain'],
  },
  chains: {
    testnet: {
      name: 'Testnet',
      chainId: 999999,
      symbol: 'ETH',
      explorerName: 'Explorer',
    },
    mainnet: {
      name: 'Mainnet',
      chainId: 999998,
      symbol: 'ETH',
      explorerName: 'Explorer',
    },
  },
  urls: {
    website: 'https://example.com',
    docs: 'https://docs.example.com',
    explorer: {
      testnet: 'https://testnet-explorer.example.com',
      mainnet: 'https://explorer.example.com',
    },
    rpc: {
      testnet: 'https://testnet-rpc.example.com',
      mainnet: 'https://rpc.example.com',
    },
    api: {
      testnet: 'https://testnet-api.example.com',
      mainnet: 'https://api.example.com',
    },
    gateway: {
      testnet: 'https://testnet.example.com',
      mainnet: 'https://app.example.com',
    },
    github: 'https://github.com/example/network',
    twitter: 'https://twitter.com/example',
    discord: 'https://discord.gg/example',
    telegram: 'https://t.me/example',
  },
  tokens: {
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    governance: { name: 'Token', symbol: 'TKN', decimals: 18 },
  },
  branding: {
    primaryColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    accentColor: '#06b6d4',
    backgroundColor: '#0f172a',
    textColor: '#f8fafc',
    logo: {
      light: '/assets/logo-light.svg',
      dark: '/assets/logo-dark.svg',
      icon: '/assets/icon.svg',
    },
    favicon: '/favicon.ico',
  },
  features: {
    flashblocks: true,
    flashblocksSubBlockTime: 200,
    blockTime: 2000,
    erc4337: true,
    crossChain: true,
    governance: true,
    staking: true,
    identityRegistry: true,
  },
  legal: {
    companyName: 'Network Foundation',
    termsUrl: 'https://example.com/terms',
    privacyUrl: 'https://example.com/privacy',
    copyrightYear: new Date().getFullYear(),
  },
  support: {
    email: 'support@example.com',
    discordChannel: '#support',
  },
  cli: {
    name: 'network',
    displayName: 'Network CLI',
    banner: ['  MY NETWORK  '],
  },
}

// ============================================================================
// Loader
// ============================================================================

let brandingCache: BrandingConfig | null = null
let configPath: string | null = null

function findConfigDir(): string {
  // Try multiple locations
  const locations = [
    // From packages/config
    join(dirname(fileURLToPath(import.meta.url)), '.'),
    // From workspace root
    join(process.cwd(), 'packages', 'config'),
    // From any package
    join(process.cwd(), '..', '..', 'packages', 'config'),
  ]

  for (const loc of locations) {
    const brandingPath = join(loc, 'branding.json')
    if (existsSync(brandingPath)) {
      return loc
    }
  }

  // Return first location for error message in loadBrandingFile
  // The array is always populated, so first element is guaranteed
  const firstLocation = locations[0]
  if (!firstLocation) {
    throw new Error('No config locations defined')
  }
  return firstLocation
}

/** Safely read a file with error handling */
function safeReadFile(path: string): string {
  return readFileSync(path, 'utf-8')
}

function loadBrandingFile(): BrandingConfig {
  const dir = configPath ?? findConfigDir()
  const brandingPath = join(dir, 'branding.json')

  if (!existsSync(brandingPath)) {
    throw new Error(
      `branding.json not found at ${brandingPath}. ` +
        `Create it from the template or set config path with setConfigPath().`,
    )
  }

  const content = safeReadFile(brandingPath)
  return BrandingConfigSchema.parse(JSON.parse(content))
}

/**
 * Set custom config path (useful for forks)
 */
export function setConfigPath(path: string): void {
  configPath = path
  brandingCache = null
}

/**
 * Get the full branding configuration
 */
export function getBranding(): BrandingConfig {
  if (!brandingCache) {
    brandingCache = loadBrandingFile()
  }
  return brandingCache
}

/**
 * Clear the branding cache (useful for testing)
 */
export function clearBrandingCache(): void {
  brandingCache = null
}

// ============================================================================
// Convenience Accessors
// ============================================================================

/** Get network name (e.g., "Network") */
export function getNetworkName(): string {
  return getBranding().network.name
}

/** Get network display name (e.g., "the network") */
export function getNetworkDisplayName(): string {
  return getBranding().network.displayName
}

/** Get network tagline */
export function getNetworkTagline(): string {
  return getBranding().network.tagline
}

/** Get network description */
export function getNetworkDescription(): string {
  return getBranding().network.description
}

/** Get chain config for testnet or mainnet */
export function getChainBranding(
  network: 'testnet' | 'mainnet',
): ChainBranding {
  return getBranding().chains[network]
}

/** Get URL config */
export function getUrls(): UrlsBranding {
  return getBranding().urls
}

/** Get visual branding (colors, logo) */
export function getVisualBranding(): VisualBranding {
  return getBranding().branding
}

/** Get feature flags */
export function getFeatures(): FeaturesBranding {
  return getBranding().features
}

/** Get CLI branding */
export function getCliBranding(): CliBranding {
  return getBranding().cli
}

/** Get legal info */
export function getLegal(): LegalBranding {
  return getBranding().legal
}

/** Get support info */
export function getSupport(): SupportBranding {
  return getBranding().support
}

/** Get native token info */
export function getNativeToken(): TokenBranding {
  return getBranding().tokens.native
}

/** Get governance token info */
export function getGovernanceToken(): TokenBranding {
  return getBranding().tokens.governance
}

/** Get website URL */
export function getWebsiteUrl(): string {
  return getBranding().urls.website
}

/** Get explorer URL for a specific network */
export function getExplorerUrl(network: 'testnet' | 'mainnet'): string {
  return getBranding().urls.explorer[network]
}

/** Get RPC URL for a specific network */
export function getRpcUrl(network: 'testnet' | 'mainnet'): string {
  return getBranding().urls.rpc[network]
}

/** Get API URL for a specific network */
export function getApiUrl(network: 'testnet' | 'mainnet'): string {
  return getBranding().urls.api[network]
}

/** Get gateway URL for a specific network */
export function getGatewayUrl(network: 'testnet' | 'mainnet'): string {
  return getBranding().urls.gateway[network]
}

// ============================================================================
// Template Helpers
// ============================================================================

/**
 * Replace {placeholders} in a string with branding values
 */
export function interpolate(template: string): string {
  const branding = getBranding()

  return template
    .replace(/\{networkName\}/g, branding.network.name)
    .replace(/\{networkDisplayName\}/g, branding.network.displayName)
    .replace(/\{tagline\}/g, branding.network.tagline)
    .replace(/\{description\}/g, branding.network.description)
    .replace(/\{website\}/g, branding.urls.website)
    .replace(/\{docs\}/g, branding.urls.docs)
    .replace(/\{github\}/g, branding.urls.github)
    .replace(/\{twitter\}/g, branding.urls.twitter)
    .replace(/\{discord\}/g, branding.urls.discord)
    .replace(/\{testnetChainId\}/g, branding.chains.testnet.chainId.toString())
    .replace(/\{mainnetChainId\}/g, branding.chains.mainnet.chainId.toString())
    .replace(/\{testnetName\}/g, branding.chains.testnet.name)
    .replace(/\{mainnetName\}/g, branding.chains.mainnet.name)
    .replace(/\{nativeSymbol\}/g, branding.tokens.native.symbol)
    .replace(/\{governanceSymbol\}/g, branding.tokens.governance.symbol)
    .replace(/\{cliName\}/g, branding.cli.name)
    .replace(/\{companyName\}/g, branding.legal.companyName)
    .replace(/\{year\}/g, branding.legal.copyrightYear.toString())
}

/**
 * Generate branding.json for a forked network
 */
export function generateForkBranding(options: {
  name: string
  displayName?: string
  tagline?: string
  chainId: number
  domain?: string
  tokenSymbol?: string
  governanceTokenName?: string
  governanceTokenSymbol?: string
}): BrandingConfig {
  const name = options.name
  const displayName = options.displayName || `${name} Network`
  const domain =
    options.domain || `${name.toLowerCase().replace(/\s+/g, '')}.network`
  const tokenSymbol = options.tokenSymbol || 'ETH'
  const govName = options.governanceTokenName || `${name} Token`
  const govSymbol =
    options.governanceTokenSymbol || name.toUpperCase().slice(0, 4)

  return {
    version: '1.0.0',
    network: {
      name,
      displayName,
      tagline: options.tagline || `The ${name} L2 network`,
      description: `${displayName} is a decentralized L2 network built on the OP Stack.`,
      shortDescription: `${name} L2`,
      keywords: ['L2', 'EVM', 'OP Stack', name],
    },
    chains: {
      testnet: {
        name: `${name} Testnet`,
        chainId: options.chainId,
        symbol: tokenSymbol,
        explorerName: `${name} Explorer`,
      },
      mainnet: {
        name: `${name} Mainnet`,
        chainId: options.chainId + 1,
        symbol: tokenSymbol,
        explorerName: `${name} Explorer`,
      },
    },
    urls: {
      website: `https://${domain}`,
      docs: `https://docs.${domain}`,
      explorer: {
        testnet: `https://testnet-explorer.${domain}`,
        mainnet: `https://explorer.${domain}`,
      },
      rpc: {
        testnet: `https://testnet-rpc.${domain}`,
        mainnet: `https://rpc.${domain}`,
      },
      api: {
        testnet: `https://testnet-api.${domain}`,
        mainnet: `https://api.${domain}`,
      },
      gateway: {
        testnet: `https://testnet.${domain}`,
        mainnet: `https://app.${domain}`,
      },
      github: `https://github.com/${name.toLowerCase()}-network/${name.toLowerCase()}`,
      twitter: `https://twitter.com/${name.toLowerCase()}network`,
      discord: `https://discord.gg/${name.toLowerCase()}`,
      telegram: `https://t.me/${name.toLowerCase()}network`,
    },
    tokens: {
      native: { name: 'Ether', symbol: tokenSymbol, decimals: 18 },
      governance: { name: govName, symbol: govSymbol, decimals: 18 },
    },
    branding: {
      primaryColor: '#6366f1',
      secondaryColor: '#8b5cf6',
      accentColor: '#06b6d4',
      backgroundColor: '#0f172a',
      textColor: '#f8fafc',
      logo: {
        light: '/assets/logo-light.svg',
        dark: '/assets/logo-dark.svg',
        icon: '/assets/icon.svg',
      },
      favicon: '/favicon.ico',
    },
    features: {
      flashblocks: true,
      flashblocksSubBlockTime: 200,
      blockTime: 2000,
      erc4337: true,
      crossChain: true,
      governance: true,
      staking: true,
      identityRegistry: true,
    },
    legal: {
      companyName: `${name} Foundation`,
      termsUrl: `https://${domain}/terms`,
      privacyUrl: `https://${domain}/privacy`,
      copyrightYear: new Date().getFullYear(),
    },
    support: {
      email: `support@${domain}`,
      discordChannel: '#support',
    },
    cli: {
      name: name.toLowerCase().replace(/\s+/g, '-'),
      displayName: `${name} CLI`,
      banner: generateAsciiBanner(name),
    },
  }
}

/**
 * Generate a simple ASCII banner for the CLI
 */
function generateAsciiBanner(name: string): string[] {
  const upper = name.toUpperCase()
  const pad = ' '.repeat(Math.max(0, (40 - upper.length) / 2))
  return [
    `╔${'═'.repeat(42)}╗`,
    `║${pad}${upper}${pad}${upper.length % 2 === 0 ? '' : ' '}║`,
    `╚${'═'.repeat(42)}╝`,
  ]
}
