import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, base, arbitrum, optimism, bsc } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';
import { getUrls, getLocalnetChain, getTestnetChain } from './config/branding';
import App from './App';
import './index.css';

// RPC endpoints from branding config
const urls = getUrls();
const NETWORK_RPC = import.meta.env.VITE_NETWORK_RPC_URL || urls.rpc.mainnet;

// Chain definitions from shared config
const networkLocalnet = getLocalnetChain();
const networkTestnet = getTestnetChain();

// Supported chains (popular EVM + network chains)
const chains = [mainnet, base, arbitrum, optimism, bsc, networkLocalnet, networkTestnet] as const;

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
    // All RPCs go through network infrastructure - open API, no keys required
    [mainnet.id]: http(`${NETWORK_RPC}/eth`),
    [base.id]: http(`${NETWORK_RPC}/base`),
    [arbitrum.id]: http(`${NETWORK_RPC}/arbitrum`),
    [optimism.id]: http(`${NETWORK_RPC}/optimism`),
    [bsc.id]: http(`${NETWORK_RPC}/bsc`),
    [networkLocalnet.id]: http('http://localhost:9545'),
    [networkTestnet.id]: http(urls.rpc.testnet),
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
