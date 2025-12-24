import { getCoreAppUrl } from '@jejunetwork/config'
import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { JEJU_RPC_URL, jeju } from './chains'
import { NETWORK_NAME } from './index'

const localnet = defineChain({
  id: 1337,
  name: `${NETWORK_NAME} Localnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [JEJU_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Explorer`,
      url: getCoreAppUrl('EXPLORER'),
    },
  },
  testnet: true,
})

const activeChain = process.env.PUBLIC_CHAIN_ID === '1337' ? localnet : jeju

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [activeChain.id]: http(activeChain.rpcUrls.default.http[0], {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  ssr: true,
})

// Export for OAuth3 provider
export const chainId = activeChain.id
export const rpcUrl = activeChain.rpcUrls.default.http[0]
