// Force viem mainnet initialization before RainbowKit imports
import { mainnet as viemMainnet } from 'viem/chains'

viemMainnet.id // Force initialization

import { OAuth3Provider } from '@jejunetwork/auth'
import {
  darkTheme,
  getDefaultConfig,
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { http, WagmiProvider } from 'wagmi'
import '@rainbow-me/rainbowkit/styles.css'
import App from './App'
import './styles/index.css'
import {
  CHAIN_ID,
  NETWORK,
  OAUTH3_AGENT_URL,
  RPC_URL,
  WALLETCONNECT_PROJECT_ID,
} from './config'

const jejuChain = {
  id: CHAIN_ID,
  name:
    NETWORK === 'mainnet'
      ? 'Jeju Network'
      : NETWORK === 'testnet'
        ? 'Jeju Testnet'
        : 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const

// Use a placeholder project ID for local development if none is configured
// This prevents WalletConnect initialization errors, but WalletConnect features won't work
const wcProjectId = WALLETCONNECT_PROJECT_ID || 'LOCAL_DEV_PLACEHOLDER'

const config = getDefaultConfig({
  appName: 'DWS Console',
  projectId: wcProjectId,
  // Include mainnet for ENS resolution
  chains: [jejuChain, viemMainnet],
  transports: {
    [jejuChain.id]: http(),
    [viemMainnet.id]: http(),
  },
  ssr: false,
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      refetchOnWindowFocus: false,
    },
  },
})

const rainbowTheme = darkTheme({
  accentColor: '#06b6d4',
  accentColorForeground: 'white',
  borderRadius: 'medium',
  fontStack: 'system',
})

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rainbowTheme}>
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
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  )
}
