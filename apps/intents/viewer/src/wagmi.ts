/**
 * @fileoverview Wagmi + RainbowKit configuration for OIF Viewer
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { arbitrum, optimism, mainnet, sepolia } from 'wagmi/chains';
import type { Chain } from 'wagmi/chains';

// Custom Jeju chain definition
export const jeju: Chain = {
  id: 420690,
  name: 'Jeju',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { 
      http: [import.meta.env.VITE_JEJU_RPC_URL || 'https://rpc.testnet.jeju.network'] 
    },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: import.meta.env.VITE_JEJU_EXPLORER_URL || 'https://explorer.testnet.jeju.network' },
  },
  testnet: true,
};

// RainbowKit config
export const config = getDefaultConfig({
  appName: 'Jeju Intent Viewer',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'oif-viewer',
  chains: [jeju, sepolia, arbitrum, optimism, mainnet],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [jeju.id]: http(import.meta.env.VITE_JEJU_RPC_URL || 'https://rpc.testnet.jeju.network'),
  },
});

// OIF Contract addresses per chain (populated from environment)
export const OIF_CONTRACTS = {
  inputSettlers: {
    [jeju.id]: import.meta.env.VITE_OIF_INPUT_SETTLER_420690 as `0x${string}` | undefined,
    [sepolia.id]: import.meta.env.VITE_OIF_INPUT_SETTLER_11155111 as `0x${string}` | undefined,
    [mainnet.id]: import.meta.env.VITE_OIF_INPUT_SETTLER_1 as `0x${string}` | undefined,
    [arbitrum.id]: import.meta.env.VITE_OIF_INPUT_SETTLER_42161 as `0x${string}` | undefined,
    [optimism.id]: import.meta.env.VITE_OIF_INPUT_SETTLER_10 as `0x${string}` | undefined,
  },
  outputSettlers: {
    [jeju.id]: import.meta.env.VITE_OIF_OUTPUT_SETTLER_420690 as `0x${string}` | undefined,
    [sepolia.id]: import.meta.env.VITE_OIF_OUTPUT_SETTLER_11155111 as `0x${string}` | undefined,
    [mainnet.id]: import.meta.env.VITE_OIF_OUTPUT_SETTLER_1 as `0x${string}` | undefined,
    [arbitrum.id]: import.meta.env.VITE_OIF_OUTPUT_SETTLER_42161 as `0x${string}` | undefined,
    [optimism.id]: import.meta.env.VITE_OIF_OUTPUT_SETTLER_10 as `0x${string}` | undefined,
  },
  solverRegistries: {
    [jeju.id]: import.meta.env.VITE_OIF_SOLVER_REGISTRY_420690 as `0x${string}` | undefined,
    [mainnet.id]: import.meta.env.VITE_OIF_SOLVER_REGISTRY_1 as `0x${string}` | undefined,
  },
} as const;

// Aggregator URL
export const AGGREGATOR_URL = import.meta.env.VITE_OIF_AGGREGATOR_URL || 'http://localhost:4010';

