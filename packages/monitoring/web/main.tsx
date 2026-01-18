import { OAuth3Provider } from '@jejunetwork/auth/react'
import {
  getChainId,
  getCurrentNetwork,
  getOAuth3Url,
  getRpcUrl,
} from '@jejunetwork/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <OAuth3Provider
        config={{
          appId: 'monitoring.apps.jeju',
          redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
          chainId: getChainId(getCurrentNetwork()),
          rpcUrl: getRpcUrl(getCurrentNetwork()),
          teeAgentUrl: getOAuth3Url(getCurrentNetwork()),
          network: getCurrentNetwork(),
          decentralized: getCurrentNetwork() !== 'localnet',
        }}
        autoConnect={true}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </OAuth3Provider>
    </QueryClientProvider>
  </React.StrictMode>,
)
