/**
 * Chain Definitions using Branding Config
 * 
 * Provides viem/wagmi-compatible chain objects that use the branding config.
 * This ensures all apps use consistent, configurable chain names.
 */

import { getBranding, type BrandingConfig } from '@jejunetwork/config';
import type { Chain } from 'viem';

let brandingCache: BrandingConfig | null = null;

function getBrandingConfig(): BrandingConfig {
  if (!brandingCache) {
    brandingCache = getBranding();
  }
  return brandingCache;
}

/**
 * Get the localnet chain definition
 */
export function getLocalnetChain(): Chain {
  const branding = getBrandingConfig();
  const name = branding.network.name;
  
  return {
    id: 1337,
    name: `${name} Localnet`,
    nativeCurrency: {
      name: branding.tokens.native.name,
      symbol: branding.tokens.native.symbol,
      decimals: 18,
    },
    rpcUrls: {
      default: { http: ['http://localhost:9545'] },
    },
    blockExplorers: {
      default: { name: 'Local Explorer', url: 'http://localhost:4000' },
    },
  };
}

/**
 * Get the testnet chain definition
 */
export function getTestnetChain(): Chain {
  const branding = getBrandingConfig();
  const testnet = branding.chains.testnet;
  const urls = branding.urls;
  
  return {
    id: testnet.chainId,
    name: testnet.name,
    nativeCurrency: {
      name: branding.tokens.native.name,
      symbol: testnet.symbol,
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [urls.rpc.testnet] },
    },
    blockExplorers: {
      default: { name: testnet.explorerName, url: urls.explorer.testnet },
    },
  };
}

/**
 * Get the mainnet chain definition
 */
export function getMainnetChain(): Chain {
  const branding = getBrandingConfig();
  const mainnet = branding.chains.mainnet;
  const urls = branding.urls;
  
  return {
    id: mainnet.chainId,
    name: mainnet.name,
    nativeCurrency: {
      name: branding.tokens.native.name,
      symbol: mainnet.symbol,
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [urls.rpc.mainnet] },
    },
    blockExplorers: {
      default: { name: mainnet.explorerName, url: urls.explorer.mainnet },
    },
  };
}

/**
 * Get all network chains (localnet, testnet, mainnet)
 */
export function getNetworkChains(): [Chain, Chain, Chain] {
  return [getLocalnetChain(), getTestnetChain(), getMainnetChain()];
}

/**
 * Get chain by network type
 */
export function getChain(network: 'localnet' | 'testnet' | 'mainnet'): Chain {
  switch (network) {
    case 'localnet':
      return getLocalnetChain();
    case 'testnet':
      return getTestnetChain();
    case 'mainnet':
      return getMainnetChain();
  }
}

/**
 * Provider/service info for A2A cards
 */
export function getProviderInfo(): { organization: string; url: string } {
  const branding = getBrandingConfig();
  return {
    organization: branding.legal.companyName,
    url: branding.urls.website,
  };
}

/**
 * Get service name for a given service
 */
export function getServiceName(service: string): string {
  const branding = getBrandingConfig();
  return `${branding.network.name} ${service}`;
}

/**
 * Generate an A2A agent card with branding
 */
export function createAgentCard(options: {
  name: string;
  description: string;
  url?: string;
  version?: string;
  skills?: Array<{ id: string; name: string; description: string; tags?: string[] }>;
}): {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: string;
  provider: { organization: string; url: string };
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{ id: string; name: string; description: string; tags?: string[] }>;
} {
  const branding = getBrandingConfig();
  
  return {
    protocolVersion: '0.3.0',
    name: `${branding.network.name} ${options.name}`,
    description: options.description,
    url: options.url || '/api/a2a',
    preferredTransport: 'http',
    provider: {
      organization: branding.legal.companyName,
      url: branding.urls.website,
    },
    version: options.version || '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: options.skills ?? [],
  };
}

