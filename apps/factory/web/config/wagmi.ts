import { getChainConfig, type NetworkType } from '@jejunetwork/config'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'
import { mainnet } from 'wagmi/chains'

function detectNetwork(): NetworkType {
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

const jejuChain = defineChain({
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
})

const projectId =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  !window.location.hostname.includes('local.')
    ? 'development-placeholder-id'
    : 'development-placeholder-id'

export const wagmiConfig = getDefaultConfig({
  appName: 'Factory',
  projectId,
  chains: [jejuChain, mainnet],
  ssr: false,
})

export const CHAIN_ID = chainConfig.chainId
export const RPC_URL = chainConfig.rpcUrl

export function getChainId(): number {
  return CHAIN_ID
}
