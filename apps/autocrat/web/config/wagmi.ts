import { type Config, createConfig, http } from 'wagmi'
import { injected, metaMask } from 'wagmi/connectors'
import { jejuLocalnet, jejuTestnet } from './chains'

export const wagmiConfig: Config = createConfig({
  chains: [jejuLocalnet, jejuTestnet],
  connectors: [injected(), metaMask()],
  transports: {
    [jejuLocalnet.id]: http(),
    [jejuTestnet.id]: http(),
  },
})
