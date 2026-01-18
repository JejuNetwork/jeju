/**
 * DWS Console - Decentralized Web Services
 *
 * Uses only injected wallets (MetaMask, etc.) without WalletConnect
 * or other centralized dependencies.
 */

import { OAuth3Provider } from '@jejunetwork/auth'
import type { OAuth3AppConfig } from '@jejunetwork/shared'
import { createDecentralizedWagmiConfig } from '@jejunetwork/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import App from './App'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OnboardingModal } from './components/OnboardingModal'
import { ToastContainer } from './components/ToastContainer'
import { CHAIN_ID, NETWORK, OAUTH3_AGENT_URL, RPC_URL } from './config'
import { AppProvider } from './context/AppContext'
import './styles/index.css'

const jejuChain = {
  id: CHAIN_ID,
  name:
    NETWORK === 'mainnet'
      ? 'Jeju Network'
      : NETWORK === 'testnet'
        ? 'Jeju Testnet'
        : 'Jeju Localnet',
  rpcUrl: RPC_URL,
  testnet: NETWORK !== 'mainnet',
}

// Create decentralized config - no WalletConnect, no external dependencies
const config = createDecentralizedWagmiConfig({
  chains: [jejuChain],
  appName: 'DWS Console',
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <OAuth3Provider
              config={
                {
                  appId: 'dws.apps.jeju',
                  redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
                  chainId: CHAIN_ID,
                  rpcUrl: RPC_URL,
                  teeAgentUrl: OAUTH3_AGENT_URL,
                  network: NETWORK,
                  // Only use decentralized mode when JNS is properly configured
                  decentralized: NETWORK !== 'localnet',
                } satisfies OAuth3AppConfig
              }
              autoConnect={true}
            >
              <AppProvider>
                <BrowserRouter>
                  <App />
                  <OnboardingModal />
                  <ToastContainer />
                  <ConfirmDialog />
                </BrowserRouter>
              </AppProvider>
            </OAuth3Provider>
          </QueryClientProvider>
        </WagmiProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}
