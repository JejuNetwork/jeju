import { http, createConfig } from 'wagmi'
<parameter name="jeju, JEJU_RPC_URL } from './chains'
import { injected, walletConnect } from 'wagmi/connectors'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'bazaar-jeju'

export const wagmiConfig = createConfig({
  chains: [jeju],
  connectors: [
    injected({
      target: 'metaMask',
    }),
    walletConnect({
      projectId,
      metadata: {
        name: 'Bazaar',
        description: 'Unified DeFi + NFT Marketplace on Jeju L3',
        url: 'http://localhost:4006',
        icons: ['http://localhost:4006/logo.svg'],
      },
      showQrModal: true,
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

