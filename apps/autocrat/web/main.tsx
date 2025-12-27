/**
 * Autocrat Application Entry Point
 *
 * AI-powered DAO management platform.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { base, baseSepolia, mainnet, sepolia } from 'wagmi/chains'
import { Layout } from './components/Layout'
import AgentEditPage from './pages/AgentEdit'
import CreateDAOPage from './pages/CreateDAO'
import DAODetailPage from './pages/DAODetail'
import DAOListPage from './pages/DAOList'
import ProposalPage from './pages/Proposal'
import './app/globals.css'

// Wagmi Configuration
const config = createConfig({
  chains: [mainnet, sepolia, base, baseSepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
})

// React Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 2,
    },
  },
})

function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            {/* Create DAO has its own layout */}
            <Route path="/create" element={<CreateDAOPage />} />

            {/* Main layout routes */}
            <Route element={<Layout />}>
              <Route path="/" element={<DAOListPage />} />
              <Route path="/dao/:daoId" element={<DAODetailPage />} />
              <Route
                path="/dao/:daoId/agent/:agentId"
                element={<AgentEditPage />}
              />
              <Route
                path="/dao/:daoId/proposal/:proposalId"
                element={<ProposalPage />}
              />
              <Route path="/my-daos" element={<DAOListPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
