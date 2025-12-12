import { defineChain } from 'viem'

export const jejuLocalnet = defineChain({
  id: 8545,
  name: 'Jeju Localnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://localhost:9545'] },
  },
})

export const jejuTestnet = defineChain({
  id: 84532,
  name: 'Jeju Testnet (Base Sepolia)',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
})

export const chains = [jejuLocalnet, jejuTestnet] as const
