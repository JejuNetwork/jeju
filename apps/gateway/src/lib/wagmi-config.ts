import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { CHAIN_ID, NETWORK, RPC_URL, WALLETCONNECT_PROJECT_ID } from '../config'

const jejuChain = {
  id: CHAIN_ID,
  name:
    NETWORK === 'mainnet'
      ? 'Jeju Network'
      : NETWORK === 'testnet'
        ? 'Jeju Testnet'
        : 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
} as const

const config = getDefaultConfig({
  appName: 'Gateway Portal - the network',
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [jejuChain],
  transports: {
    [jejuChain.id]: http(),
  },
  ssr: false,
})

export function getConfig() {
  return config
}

export { jejuChain, config }
