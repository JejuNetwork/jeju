'use client';

import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

const jejuChain = {
  id: parseInt(
    process.env.NEXT_PUBLIC_CHAIN_ID || 
    process.env.PREDIMARKET_CHAIN_ID || 
    '1337'
  ),
  name: 'Jeju Network',
  network: 'jeju',
  nativeCurrency: {
    decimals: 18,
    name: 'Ethereum',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { 
      http: [
        process.env.NEXT_PUBLIC_RPC_URL || 
        process.env.PREDIMARKET_RPC_URL || 
        `http://localhost:${process.env.L2_RPC_PORT || '9545'}`
      ] 
    },
    public: { 
      http: [
        process.env.NEXT_PUBLIC_RPC_URL || 
        process.env.PREDIMARKET_RPC_URL || 
        `http://localhost:${process.env.L2_RPC_PORT || '9545'}`
      ] 
    },
  },
  blockExplorers: {
    default: { name: 'JejuScan', url: 'https://scan.jeju.network' },
  },
  testnet: true,
};

const config = getDefaultConfig({
  appName: 'Predimarket',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'predimarket',
  chains: [jejuChain as any],
  transports: {
    [jejuChain.id]: http(jejuChain.rpcUrls.default.http[0]),
  },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

