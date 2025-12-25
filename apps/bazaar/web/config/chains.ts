import { type Address, defineChain } from 'viem'
import { CHAIN_ID, EXPLORER_URL, NETWORK, NETWORK_NAME, RPC_URL } from './index'

export const JEJU_CHAIN_ID = CHAIN_ID
export const JEJU_RPC_URL = RPC_URL

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

export interface OIFChainInfo {
  id: number
  chainId: number
  name: string
  symbol: string
  inputSettler?: Address
}
function createChainInfo(
  chainId: number,
  name: string,
  symbol: string,
): OIFChainInfo {
  return { id: chainId, chainId, name, symbol }
}

export const OIF_SUPPORTED_CHAINS: OIFChainInfo[] = [
  createChainInfo(1, 'Ethereum', 'ETH'),
  createChainInfo(10, 'Optimism', 'ETH'),
  createChainInfo(137, 'Polygon', 'MATIC'),
  createChainInfo(42161, 'Arbitrum', 'ETH'),
  createChainInfo(8453, 'Base', 'ETH'),
  createChainInfo(420690, 'Jeju Testnet', 'ETH'),
  createChainInfo(420691, 'Jeju Mainnet', 'ETH'),
]
