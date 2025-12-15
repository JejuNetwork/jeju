import { defineChain } from 'viem';
import { CHAIN_ID, RPC_URL, NETWORK } from './index';
import { getNetworkName, getBrandingExplorerUrl } from '@jejunetwork/config';

export const JEJU_CHAIN_ID = CHAIN_ID;
export const JEJU_RPC_URL = RPC_URL;

const networkName = getNetworkName();

function getChainName(): string {
  switch (NETWORK) {
    case 'mainnet': return networkName;
    case 'testnet': return `${networkName} Testnet`;
    default: return `${networkName} Localnet`;
  }
}

function getExplorerUrlForNetwork(): string {
  switch (NETWORK) {
    case 'mainnet': return getBrandingExplorerUrl('mainnet');
    case 'testnet': return getBrandingExplorerUrl('testnet');
    default: return 'http://localhost:4000';
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
      name: `${networkName} Explorer`,
      url: getExplorerUrlForNetwork(),
      apiUrl: `${getExplorerUrlForNetwork()}/api`,
    },
  },
  testnet: NETWORK !== 'mainnet',
});
