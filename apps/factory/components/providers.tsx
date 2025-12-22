'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { OAuth3Provider } from '@jejunetwork/oauth3/react';
import { wagmiConfig, CHAIN_ID, RPC_URL, OAUTH3_AGENT_URL } from '@/config/wagmi';
import { Toaster } from 'sonner';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <OAuth3Provider
            config={{
              appId: 'factory.apps.jeju',
              redirectUri: typeof window !== 'undefined' 
                ? `${window.location.origin}/auth/callback` 
                : 'http://localhost:4009/auth/callback',
              chainId: CHAIN_ID,
              rpcUrl: RPC_URL,
              teeAgentUrl: OAUTH3_AGENT_URL,
              decentralized: true,
            }}
            autoConnect={true}
          >
            {children}
            <Toaster 
              position="bottom-right" 
              theme="dark"
              toastOptions={{
                className: 'bg-factory-900 border-factory-700 text-factory-100',
              }}
            />
          </OAuth3Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

