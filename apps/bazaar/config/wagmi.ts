import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { jeju, JEJU_RPC_URL } from './chains'
import { injected } from 'wagmi/connectors'
import { getNetworkName } from '@jejunetwork/config'

const networkName = getNetworkName()

const localnet = defineChain({
  id: 1337,
  name: `${networkName} Localnet`,
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
      name: `${networkName} Explorer`,
      url: 'http://localhost:4004',
    },
  },
  testnet: true,
})

const activeChain = process.env.NEXT_PUBLIC_CHAIN_ID === '1337' ? localnet : jeju

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