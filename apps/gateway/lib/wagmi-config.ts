import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { CHAIN_ID, NETWORK, RPC_URL, WALLETCONNECT_PROJECT_ID } from './config'

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

// Define mainnet chain inline to avoid lazy initialization issues
const ethereumMainnet = {
  id: 1,
  name: 'Ethereum',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://eth.merkle.io'] },
    public: { http: ['https://eth.merkle.io'] },
  },
} as const

// Use placeholder project ID for local dev if none configured
const wcProjectId = WALLETCONNECT_PROJECT_ID || 'LOCAL_DEV_PLACEHOLDER'

const config = getDefaultConfig({
  appName: 'Gateway - the network',
  projectId: wcProjectId,
  // Include mainnet for RainbowKit compatibility (needed for ENS resolution)
  chains: [jejuChain, ethereumMainnet],
  transports: {
    [jejuChain.id]: http(),
    [ethereumMainnet.id]: http(),
  },
  ssr: false,
})

export function getConfig() {
  return config
}

export { jejuChain, config }
