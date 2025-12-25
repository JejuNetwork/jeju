import { getChainConfig } from '@jejunetwork/config'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import type { Chain } from 'wagmi/chains'
import { mainnet } from 'wagmi/chains'

function detectNetwork(): 'localnet' | 'testnet' | 'mainnet' {
  if (typeof window === 'undefined') return 'localnet'
  const hostname = window.location.hostname
  if (hostname.includes('testnet') || hostname.includes('sepolia'))
    return 'testnet'
  if (
    hostname === 'factory.jejunetwork.org' ||
    hostname === 'factory.jeju.network'
  )
    return 'mainnet'
  return 'localnet'
}

const network = detectNetwork()
const chainConfig = getChainConfig(network)

const currentChain: Chain = {
  id: chainConfig.chainId,
  name: chainConfig.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [chainConfig.rpcUrl] },
  },
  blockExplorers: chainConfig.explorerUrl
    ? {
        default: { name: 'Explorer', url: chainConfig.explorerUrl },
      }
    : undefined,
  testnet: network !== 'mainnet',
}

// Include mainnet for ENS resolution in RainbowKit
export const chains: [Chain, ...Chain[]] = [currentChain, mainnet]

const projectId = (() => {
  if (
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    !window.location.hostname.includes('local.')
  ) {
    console.warn(
      'WalletConnect: Using placeholder ID. Set WALLETCONNECT_PROJECT_ID for production.',
    )
  }
  return 'development-placeholder-id'
})()

export const wagmiConfig = getDefaultConfig({
  appName: 'Factory',
  projectId,
  chains,
  ssr: false,
}) as ReturnType<typeof getDefaultConfig>

export const CHAIN_ID = chainConfig.chainId
export const RPC_URL = chainConfig.rpcUrl

export function getChainId(): number {
  return CHAIN_ID
}
