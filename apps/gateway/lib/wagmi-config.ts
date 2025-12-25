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

// Validate WalletConnect project ID for non-local networks
function getWalletConnectProjectId(): string {
  const projectId = WALLETCONNECT_PROJECT_ID
  const isPlaceholder =
    !projectId ||
    projectId === 'YOUR_PROJECT_ID' ||
    projectId === 'LOCAL_DEV_PLACEHOLDER'

  if (NETWORK === 'localnet') {
    // Use placeholder for local development
    return isPlaceholder ? 'LOCAL_DEV_PLACEHOLDER' : projectId
  }

  if (isPlaceholder) {
    throw new Error(
      `WalletConnect project ID required for ${NETWORK}. ` +
        'Set PUBLIC_WALLETCONNECT_PROJECT_ID environment variable. ' +
        'Get a project ID at https://cloud.walletconnect.com',
    )
  }

  return projectId
}

const wcProjectId = getWalletConnectProjectId()

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
