import type { Chain } from 'viem'

function isLocalRpc(url: string): boolean {
  return (
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('anvil') ||
    url.includes(':6545') ||
    url.includes(':6546') ||
    url.includes(':8545')
  )
}

export function inferChainFromRpcUrl(rpcUrl: string): Chain {
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new Error('rpcUrl is required and must be a non-empty string')
  }

  if (isLocalRpc(rpcUrl)) {
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
