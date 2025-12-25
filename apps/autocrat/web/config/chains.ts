import { defineChain } from 'viem'

// Network name - can't import from @jejunetwork/config in client code (uses fs)
const networkName = 'Jeju'

export const jejuLocalnet = defineChain({
  id: 31337,
  name: `${networkName} Localnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://localhost:6546'] },
  },
})

export const jejuTestnet = defineChain({
  id: 84532,
  name: `${networkName} Testnet (Base Sepolia)`,
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
