import { OAuth3Provider } from '@jejunetwork/auth/react'
import { getCurrentNetwork, getOAuth3Url, getRpcUrl } from '@jejunetwork/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { arbitrum, base, bsc, mainnet, optimism } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { getEnv } from '../lib/env'
import App from './App'
import { getLocalnetChain, getTestnetChain, getUrls } from './config/branding'

// CSS is loaded via Tailwind CDN in index.html for dev mode

// RPC endpoints from branding config
const urls = getUrls()
const NETWORK_RPC = getEnv('PUBLIC_NETWORK_RPC_URL') || urls.rpc.mainnet

// Chain definitions from shared config
const networkLocalnet = getLocalnetChain()
const jejuTestnet = getTestnetChain()

// Supported chains (popular EVM + network chains)
const chains = [
  mainnet,
  base,
  arbitrum,
  optimism,
  bsc,
  networkLocalnet,
  jejuTestnet,
] as const

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
    [networkLocalnet.id]: http(getRpcUrl('localnet')),
    [jejuTestnet.id]: http(urls.rpc.testnet),
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      gcTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

const NETWORK = getCurrentNetwork()

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <OAuth3Provider
            config={{
              appId: 'wallet.apps.jeju',
              redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
              chainId:
                NETWORK === 'mainnet'
                  ? 1
                  : NETWORK === 'testnet'
                    ? jejuTestnet.id
                    : networkLocalnet.id,
              rpcUrl: getRpcUrl(NETWORK),
              teeAgentUrl: getOAuth3Url(NETWORK),
              network: NETWORK,
              decentralized: NETWORK !== 'localnet',
            }}
            autoConnect={true}
          >
            <App />
          </OAuth3Provider>
        </QueryClientProvider>
      </WagmiProvider>
    </React.StrictMode>,
  )
}
