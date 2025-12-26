/**
 * DWS Console - Decentralized Web Services
 *
 * Uses only injected wallets (MetaMask, etc.) without WalletConnect
 * or other centralized dependencies.
 */

import { OAuth3Provider } from '@jejunetwork/auth'
import { createDecentralizedWagmiConfig } from '@jejunetwork/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import App from './App'
import './styles/index.css'
import { CHAIN_ID, NETWORK, OAUTH3_AGENT_URL, RPC_URL } from './config'

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
    },
  },
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <OAuth3Provider
            config={{
              appId: 'dws.apps.jeju',
              redirectUri: `${window.location.origin}/auth/callback`,
              chainId: CHAIN_ID,
              rpcUrl: RPC_URL,
              teeAgentUrl: OAUTH3_AGENT_URL,
              // Only use decentralized mode when JNS is properly configured
              decentralized: NETWORK !== 'localnet',
            }}
            autoConnect={true}
          >
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </OAuth3Provider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  )
}
