import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, base, arbitrum, optimism, bsc } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import App from './App';
import './index.css';

// Jeju RPC endpoints - fully decentralized, no API keys needed
const JEJU_RPC = 'https://rpc.jeju.network';

// Jeju localnet chain definition
const jejuLocalnet = {
  id: 1337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://localhost:8545'] },
  },
  blockExplorers: {
    default: { name: 'Local', url: 'http://localhost:4000' },
  },
} as const;

// Jeju testnet chain definition  
const jejuTestnet = {
  id: 420691,
  name: 'Jeju Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.jeju.network'] },
  },
  blockExplorers: {
    default: { name: 'Jeju Explorer', url: 'https://explorer.testnet.jeju.network' },
  },
} as const;

// Supported chains (popular EVM + Jeju)
const chains = [mainnet, base, arbitrum, optimism, bsc, jejuLocalnet, jejuTestnet] as const;

// Wagmi config - fully permissionless, no external dependencies
const config = createConfig({
  chains,
  connectors: [
    // EIP-6963 compatible injected provider detection
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    // All RPCs go through Jeju infrastructure - open API, no keys required
    [mainnet.id]: http(`${JEJU_RPC}/eth`),
    [base.id]: http(`${JEJU_RPC}/base`),
    [arbitrum.id]: http(`${JEJU_RPC}/arbitrum`),
    [optimism.id]: http(`${JEJU_RPC}/optimism`),
    [bsc.id]: http(`${JEJU_RPC}/bsc`),
    [jejuLocalnet.id]: http('http://localhost:8545'),
    [jejuTestnet.id]: http('https://rpc.testnet.jeju.network'),
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {/* @ts-expect-error - React 18 type compat with wagmi */}
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>
  );
}
