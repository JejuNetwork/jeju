import { defineChain } from 'viem'

export const JEJU_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '1337')
export const JEJU_RPC_URL = process.env.NEXT_PUBLIC_JEJU_RPC_URL || 'http://localhost:9545'

export const jeju = defineChain({
  id: JEJU_CHAIN_ID,
  name: 'Jeju',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [JEJU_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'Jeju Explorer',
      url: 'http://localhost:4004',
      apiUrl: 'http://localhost:4004/api',
    },
  },
  testnet: false,
})

