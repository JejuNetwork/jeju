'use client'

import { OAuth3Provider } from '@jejunetwork/oauth3/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { chainId, rpcUrl, wagmiConfig } from '@/config/wagmi'

const OAUTH3_AGENT_URL =
  process.env.NEXT_PUBLIC_OAUTH3_AGENT_URL || 'http://localhost:4200'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 5000,
          },
        },
      }),
  )

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OAuth3Provider
          config={{
            appId: 'bazaar.apps.jeju',
            redirectUri:
              typeof window !== 'undefined'
                ? `${window.location.origin}/auth/callback`
                : 'http://localhost:4006/auth/callback',
            chainId,
            rpcUrl,
            teeAgentUrl: OAUTH3_AGENT_URL,
            decentralized: true,
          }}
          autoConnect={true}
        >
          {children}
        </OAuth3Provider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
