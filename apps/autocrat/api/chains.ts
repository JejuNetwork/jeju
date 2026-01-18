/**
 * Custom chain definitions for Jeju Network
 * These avoid importing from viem/chains which can cause bundling issues
 * with process.env access at runtime when minified
 */
import { type Chain, defineChain } from 'viem'

export const jejuTestnet: Chain = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jejunetwork.org'] },
    public: { http: ['https://testnet-rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: 'https://testnet-explorer.jejunetwork.org',
    },
  },
  testnet: true,
})

export const jejuMainnet: Chain = defineChain({
  id: 420691,
  name: 'Jeju Network',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.jejunetwork.org'] },
    public: { http: ['https://rpc.jejunetwork.org'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.jejunetwork.org' },
  },
  testnet: false,
})

// Localhost for local development - defaults to 6546 (L2) for OP Stack
const LOCALHOST_RPC = process.env.RPC_URL ?? 'http://127.0.0.1:6546'
export const localhost: Chain = defineChain({
  id: 31337,
  name: 'Localhost',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [LOCALHOST_RPC] },
    public: { http: [LOCALHOST_RPC] },
  },
  testnet: true,
})

/**
 * Infer chain from RPC URL
 * Returns Jeju chain definitions instead of viem/chains to avoid bundling issues
 */
export function inferChainFromRpcUrl(rpcUrl: string): Chain {
  // Jeju chains
  if (rpcUrl.includes('jejunetwork.org')) {
    if (rpcUrl.includes('testnet')) {
      return jejuTestnet
    }
    return jejuMainnet
  }
  // Localhost/local development
  if (
    rpcUrl.includes('localhost') ||
    rpcUrl.includes('127.0.0.1') ||
    rpcUrl.includes('8545') ||
    rpcUrl.includes('6545') ||
    rpcUrl.includes('6546')
  ) {
    return localhost
  }
  // Default to testnet
  return jejuTestnet
}

/**
 * Get chain by chain ID
 */
export function getChainById(chainId: number): Chain {
  switch (chainId) {
    case 420690:
      return jejuTestnet
    case 420691:
      return jejuMainnet
    case 31337:
      return localhost
    default:
      // Unknown chain ID - default to testnet
      return jejuTestnet
  }
}
