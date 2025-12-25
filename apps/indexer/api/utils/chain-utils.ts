import type { Chain } from 'viem'

export function inferChainFromRpcUrl(rpcUrl: string): Chain {
  if (!rpcUrl || typeof rpcUrl !== 'string' || rpcUrl.trim().length === 0) {
    throw new Error('rpcUrl is required and must be a non-empty string')
  }

  if (
    rpcUrl.includes('localhost') ||
    rpcUrl.includes('127.0.0.1') ||
    rpcUrl.includes(':6545') ||
    rpcUrl.includes(':6546') ||
    rpcUrl.includes(':6547')
  ) {
    return {
      id: 31337,
      name: 'Local Network',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }
  }
  if (rpcUrl.includes('testnet')) {
    return {
      id: 420691,
      name: 'Network Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }
  }
  return {
    id: 42069,
    name: 'Network',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}
