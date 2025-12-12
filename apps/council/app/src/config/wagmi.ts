import { http, createConfig } from 'wagmi'
import { injected, metaMask } from 'wagmi/connectors'
import { jejuLocalnet, jejuTestnet } from './chains'

export const wagmiConfig = createConfig({
  chains: [jejuLocalnet, jejuTestnet],
  connectors: [
    injected(),
    metaMask(),
  ],
  transports: {
    [jejuLocalnet.id]: http(),
    [jejuTestnet.id]: http(),
  },
})
