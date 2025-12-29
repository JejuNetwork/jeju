import { isLocalnet } from '@jejunetwork/config/ports'
import type { Chain } from 'viem'

export function inferChainFromRpcUrl(rpcUrl: string): Chain {
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new Error('rpcUrl is required and must be a non-empty string')
  }

  if (isLocalnet(rpcUrl)) {
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
