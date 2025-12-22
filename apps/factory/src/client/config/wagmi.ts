import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import type { Chain } from 'wagmi/chains'

// WalletConnect Project ID
const projectId = (() => {
  const id = process.env.PUBLIC_WALLETCONNECT_ID
  if (
    !id &&
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost'
  ) {
    console.warn('WALLETCONNECT_ID not configured for production')
  }
  return id || 'development-placeholder-id'
})()

// Jeju L2 chain configs
const jejuLocalnet: Chain = {
  id: 31337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:9545'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'http://localhost:9545' },
  },
  testnet: true,
}

const jejuTestnet: Chain = {
  id: 84532,
  name: 'Jeju Testnet (Base Sepolia)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://sepolia.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
}

const jejuMainnet: Chain = {
  id: 8453,
  name: 'Jeju Mainnet (Base)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://basescan.org' },
  },
}

// Determine which network to use based on env
const getChains = (): [Chain, ...Chain[]] => {
  const network = process.env.PUBLIC_NETWORK || 'localnet'
  switch (network) {
    case 'mainnet':
      return [jejuMainnet]
    case 'testnet':
      return [jejuTestnet]
    default:
      return [jejuLocalnet]
  }
}

export const chains = getChains()

export const wagmiConfig = getDefaultConfig({
  appName: 'Factory',
  projectId,
  chains,
  ssr: false,
})

export const getChainId = () => {
  const network = process.env.PUBLIC_NETWORK || 'localnet'
  switch (network) {
    case 'mainnet':
      return 8453
    case 'testnet':
      return 84532
    default:
      return 31337
  }
}

export const CHAIN_ID = getChainId()

export const RPC_URL = (() => {
  const network = process.env.PUBLIC_NETWORK || 'localnet'
  switch (network) {
    case 'mainnet':
      return 'https://mainnet.base.org'
    case 'testnet':
      return 'https://sepolia.base.org'
    default:
      return 'http://localhost:9545'
  }
})()
