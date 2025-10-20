import { http, createConfig } from 'wagmi'
import { jeju, JEJU_RPC_URL } from './chains'
import { injected } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [jeju],
  connectors: [
    injected({
      target: 'metaMask',
    }),
  ],
  transports: {
    [jeju.id]: http(JEJU_RPC_URL, {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  ssr: true,
})

