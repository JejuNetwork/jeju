import {
  getChainId,
  getLocalhostHost,
  getRpcUrl,
  getServicesConfig,
} from '@jejunetwork/config'
import { defineChain } from 'viem'
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { NETWORK, NETWORK_NAME, RPC_URL } from './index'

const services = getServicesConfig(NETWORK)

const localnet = defineChain({
  id: getChainId('localnet'),
  name: `${NETWORK_NAME} Localnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [getRpcUrl('localnet')],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Explorer`,
      url: services.explorer || `http://${getLocalhostHost()}:4000`,
    },
  },
  testnet: true,
})

const mainnet = defineChain({
  id: getChainId('mainnet'),
  name: `${NETWORK_NAME} Mainnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [getRpcUrl('mainnet')],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Explorer`,
      url: 'https://explorer.jejunetwork.org',
    },
  },
})

const testnet = defineChain({
  id: getChainId('testnet'),
  name: `${NETWORK_NAME} Testnet`,
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [getRpcUrl('testnet')],
    },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Testnet Explorer`,
      url: 'https://testnet-explorer.jejunetwork.org',
    },
  },
  testnet: true,
})

const activeChain =
  NETWORK === 'mainnet' ? mainnet : NETWORK === 'testnet' ? testnet : localnet

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: {
    [activeChain.id]: http(RPC_URL, {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  ssr: true,
})

// Export for OAuth3 provider
export const chainId = activeChain.id
export const rpcUrl = RPC_URL
