'use client'

import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import '@rainbow-me/rainbowkit/styles.css'
import { OAuth3Provider } from '@jejunetwork/oauth3/react'
import { useState } from 'react'
import { Toaster } from 'sonner'
import {
  CHAIN_ID,
  OAUTH3_AGENT_URL,
  RPC_URL,
  wagmiConfig,
} from '@/config/wagmi'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <OAuth3Provider
            config={{
              appId: 'factory.apps.jeju',
              redirectUri:
                typeof window !== 'undefined'
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
  )
}
