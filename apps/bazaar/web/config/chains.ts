import { defineChain } from 'viem'
import {
  CHAIN_ID,
  EXPLORER_URL,
  NETWORK,
  NETWORK_NAME,
  RPC_URL,
} from './network'

export const JEJU_CHAIN_ID = CHAIN_ID
const JEJU_RPC_URL = RPC_URL

function getChainName(): string {
  switch (NETWORK) {
    case 'mainnet':
      return NETWORK_NAME
    case 'testnet':
      return `${NETWORK_NAME} Testnet`
    default:
      return `${NETWORK_NAME} Localnet`
  }
}

export const jeju = defineChain({
  id: JEJU_CHAIN_ID,
  name: getChainName(),
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [JEJU_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: `${NETWORK_NAME} Explorer`,
      url: EXPLORER_URL,
      apiUrl: `${EXPLORER_URL}/api`,
    },
  },
  testnet: NETWORK !== 'mainnet',
})

// Localnet chain for direct RPC access
export const jejuLocalnet = defineChain({
  id: 31337,
  name: 'Jeju Localnet',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: ['http://localhost:8547'] },
  },
  blockExplorers: {
    default: {
      name: 'Localnet Explorer',
      url: 'http://localhost:4000',
      apiUrl: 'http://localhost:4000/api',
    },
  },
  testnet: true,
})
