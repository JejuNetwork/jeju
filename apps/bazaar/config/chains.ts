import { defineChain } from 'viem';
import { CHAIN_ID, RPC_URL, NETWORK } from './index';

export const JEJU_CHAIN_ID = CHAIN_ID;
export const JEJU_RPC_URL = RPC_URL;

function getExplorerUrl(): string {
  switch (NETWORK) {
    case 'mainnet': return 'https://explorer.jeju.network';
    case 'testnet': return 'https://testnet-explorer.jeju.network';
    default: return 'http://localhost:4000';
  }
}

export const jeju = defineChain({
  id: JEJU_CHAIN_ID,
  name: NETWORK === 'mainnet' ? 'Jeju' : NETWORK === 'testnet' ? 'Jeju Testnet' : 'Jeju Localnet',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [JEJU_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: 'Jeju Explorer',
      url: getExplorerUrl(),
      apiUrl: `${getExplorerUrl()}/api`,
    },
  },
  testnet: NETWORK !== 'mainnet',
});
