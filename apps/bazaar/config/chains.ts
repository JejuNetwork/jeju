import { defineChain, type Address } from 'viem';
import { CHAIN_ID, RPC_URL, NETWORK, NETWORK_NAME, EXPLORER_URL } from './index';

export const JEJU_CHAIN_ID = CHAIN_ID;
export const JEJU_RPC_URL = RPC_URL;

function getChainName(): string {
  switch (NETWORK) {
    case 'mainnet': return NETWORK_NAME;
    case 'testnet': return `${NETWORK_NAME} Testnet`;
    default: return `${NETWORK_NAME} Localnet`;
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
});

// OIF Supported Chains - shared between useOIF and useIntentAPI
export interface OIFChainInfo {
  id: number;      // Chain ID (for useOIF compatibility)
  chainId: number; // Alias for chainId (for useIntentAPI compatibility)
  name: string;
  symbol: string;
  inputSettler?: Address;
}

// Helper to create chain info with both id and chainId fields
function createChainInfo(chainId: number, name: string, symbol: string): OIFChainInfo {
  return { id: chainId, chainId, name, symbol };
}

export const OIF_SUPPORTED_CHAINS: OIFChainInfo[] = [
  createChainInfo(1, 'Ethereum', 'ETH'),
  createChainInfo(10, 'Optimism', 'ETH'),
  createChainInfo(137, 'Polygon', 'MATIC'),
  createChainInfo(42161, 'Arbitrum', 'ETH'),
  createChainInfo(8453, 'Base', 'ETH'),
  createChainInfo(420690, 'Jeju Testnet', 'ETH'),
  createChainInfo(420691, 'Jeju Mainnet', 'ETH'),
];

// Input settler addresses by chain (placeholders - to be populated per network)
export const OIF_INPUT_SETTLERS: Record<number, Address> = {
  1: '0x0000000000000000000000000000000000000000',
  10: '0x0000000000000000000000000000000000000000',
  137: '0x0000000000000000000000000000000000000000',
  42161: '0x0000000000000000000000000000000000000000',
  8453: '0x0000000000000000000000000000000000000000',
  420690: '0x0000000000000000000000000000000000000000',
  420691: '0x0000000000000000000000000000000000000000',
};
