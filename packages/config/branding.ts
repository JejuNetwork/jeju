/**
 * Branding Configuration
 * 
 * Centralized branding for the entire network.
 * Fork this and edit branding.json to customize your network.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// Types
// ============================================================================

export interface ChainBranding {
  name: string;
  chainId: number;
  symbol: string;
  explorerName: string;
}

export interface TokenBranding {
  name: string;
  symbol: string;
  decimals: number;
}

export interface LogoBranding {
  light: string;
  dark: string;
  icon: string;
}

export interface UrlsBranding {
  website: string;
  docs: string;
  explorer: { testnet: string; mainnet: string };
  rpc: { testnet: string; mainnet: string };
  api: { testnet: string; mainnet: string };
  gateway: { testnet: string; mainnet: string };
  github: string;
  twitter: string;
  discord: string;
  telegram: string;
}

export interface VisualBranding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  logo: LogoBranding;
  favicon: string;
}

export interface FeaturesBranding {
  flashblocks: boolean;
  flashblocksSubBlockTime: number;
  blockTime: number;
  erc4337: boolean;
  crossChain: boolean;
  governance: boolean;
  staking: boolean;
  identityRegistry: boolean;
}

export interface LegalBranding {
  companyName: string;
  termsUrl: string;
  privacyUrl: string;
  copyrightYear: number;
}

export interface SupportBranding {
  email: string;
  discordChannel: string;
}

export interface CliBranding {
  name: string;
  displayName: string;
  banner: string[];
}

export interface BrandingConfig {
  version: string;
  network: {
    name: string;
    displayName: string;
    tagline: string;
    description: string;
    shortDescription: string;
    keywords: string[];
  };
  chains: {
    testnet: ChainBranding;
    mainnet: ChainBranding;
  };
  urls: UrlsBranding;
  tokens: {
    native: TokenBranding;
    governance: TokenBranding;
  };
  branding: VisualBranding;
  features: FeaturesBranding;
  legal: LegalBranding;
  support: SupportBranding;
  cli: CliBranding;
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_BRANDING: BrandingConfig = {
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
    explorer: { testnet: 'https://testnet-explorer.example.com', mainnet: 'https://explorer.example.com' },
    rpc: { testnet: 'https://testnet-rpc.example.com', mainnet: 'https://rpc.example.com' },
    api: { testnet: 'https://testnet-api.example.com', mainnet: 'https://api.example.com' },
    gateway: { testnet: 'https://testnet.example.com', mainnet: 'https://app.example.com' },
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
    logo: { light: '/assets/logo-light.svg', dark: '/assets/logo-dark.svg', icon: '/assets/icon.svg' },
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
};

// ============================================================================
// Loader
// ============================================================================

let brandingCache: BrandingConfig | null = null;
let configPath: string | null = null;

function findConfigDir(): string {
  // Try multiple locations
  const locations = [
    // From packages/config
    join(dirname(fileURLToPath(import.meta.url)), '.'),
    // From workspace root
    join(process.cwd(), 'packages', 'config'),
    // From any package
    join(process.cwd(), '..', '..', 'packages', 'config'),
  ];

  for (const loc of locations) {
    const brandingPath = join(loc, 'branding.json');
    if (existsSync(brandingPath)) {
      return loc;
    }
  }

  return locations[0];
}

function loadBrandingFile(): BrandingConfig {
  const dir = configPath || findConfigDir();
  const brandingPath = join(dir, 'branding.json');

  if (!existsSync(brandingPath)) {
    console.warn(`No branding.json found at ${brandingPath}, using defaults`);
    return DEFAULT_BRANDING;
  }

  const content = readFileSync(brandingPath, 'utf-8');
  return JSON.parse(content) as BrandingConfig;
}

/**
 * Set custom config path (useful for forks)
 */
export function setConfigPath(path: string): void {
  configPath = path;
  brandingCache = null;
}

/**
 * Get the full branding configuration
 */
export function getBranding(): BrandingConfig {
  if (!brandingCache) {
    brandingCache = loadBrandingFile();
  }
  return brandingCache;
}

/**
 * Clear the branding cache (useful for testing)
 */
export function clearBrandingCache(): void {
  brandingCache = null;
}

// ============================================================================
// Convenience Accessors
// ============================================================================

/** Get network name (e.g., "Network") */
export function getNetworkName(): string {
  return getBranding().network.name;
}

/** Get network display name (e.g., "the network") */
export function getNetworkDisplayName(): string {
  return getBranding().network.displayName;
}

/** Get network tagline */
export function getNetworkTagline(): string {
  return getBranding().network.tagline;
}

/** Get network description */
export function getNetworkDescription(): string {
  return getBranding().network.description;
}

/** Get chain config for testnet or mainnet */
export function getChainBranding(network: 'testnet' | 'mainnet'): ChainBranding {
  return getBranding().chains[network];
}

/** Get URL config */
export function getUrls(): UrlsBranding {
  return getBranding().urls;
}

/** Get visual branding (colors, logo) */
export function getVisualBranding(): VisualBranding {
  return getBranding().branding;
}

/** Get feature flags */
export function getFeatures(): FeaturesBranding {
  return getBranding().features;
}

/** Get CLI branding */
export function getCliBranding(): CliBranding {
  return getBranding().cli;
}

/** Get legal info */
export function getLegal(): LegalBranding {
  return getBranding().legal;
}

/** Get support info */
export function getSupport(): SupportBranding {
  return getBranding().support;
}

/** Get native token info */
export function getNativeToken(): TokenBranding {
  return getBranding().tokens.native;
}

/** Get governance token info */
export function getGovernanceToken(): TokenBranding {
  return getBranding().tokens.governance;
}

// ============================================================================
// Template Helpers
// ============================================================================

/**
 * Replace {placeholders} in a string with branding values
 */
export function interpolate(template: string): string {
  const branding = getBranding();
  
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
    .replace(/\{year\}/g, branding.legal.copyrightYear.toString());
}

/**
 * Generate branding.json for a forked network
 */
export function generateForkBranding(options: {
  name: string;
  displayName?: string;
  tagline?: string;
  chainId: number;
  domain?: string;
  tokenSymbol?: string;
  governanceTokenName?: string;
  governanceTokenSymbol?: string;
}): BrandingConfig {
  const name = options.name;
  const displayName = options.displayName || `${name} Network`;
  const domain = options.domain || `${name.toLowerCase().replace(/\s+/g, '')}.network`;
  const tokenSymbol = options.tokenSymbol || 'ETH';
  const govName = options.governanceTokenName || `${name} Token`;
  const govSymbol = options.governanceTokenSymbol || name.toUpperCase().slice(0, 4);

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
      logo: { light: '/assets/logo-light.svg', dark: '/assets/logo-dark.svg', icon: '/assets/icon.svg' },
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
  };
}

/**
 * Generate a simple ASCII banner for the CLI
 */
function generateAsciiBanner(name: string): string[] {
  const upper = name.toUpperCase();
  const pad = ' '.repeat(Math.max(0, (40 - upper.length) / 2));
  return [
    '╔' + '═'.repeat(42) + '╗',
    '║' + pad + upper + pad + (upper.length % 2 === 0 ? '' : ' ') + '║',
    '╚' + '═'.repeat(42) + '╝',
  ];
}


