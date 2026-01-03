import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { defineChain } from 'viem'
import { createConfig, http, WagmiProvider } from 'wagmi'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import AdminPage from './pages/Admin'
import AgentEditPage from './pages/AgentEdit'
import BugBountyPage from './pages/BugBounty'
import BugBountyDetailPage from './pages/BugBountyDetail'
import CreateDAOPage from './pages/CreateDAO'
import DAODetailPage from './pages/DAODetail'
import DAOListPage from './pages/DAOList'
import DirectorDashboardPage from './pages/DirectorDashboard'
import ModerationPage from './pages/Moderation'
import MyDAOsPage from './pages/MyDAOs'
import ProposalPage from './pages/Proposal'
import ProposalDetailPage from './pages/ProposalDetail'
import './app/globals.css'

// Define chains inline to avoid bundling issues with wagmi/chains
const baseSepolia = defineChain({
  id: 84532,
  name: 'Base Sepolia (Jeju Testnet)',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: ['https://sepolia.base.org'] } },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
})

// Wagmi Configuration
const config = createConfig({
  chains: [baseSepolia],
  transports: {
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

            {/* Director Dashboard has its own layout */}
            <Route path="/director" element={<DirectorDashboardPage />} />

            {/* Main layout routes */}
            <Route element={<Layout />}>
              <Route path="/" element={<DAOListPage />} />
              <Route path="/dao/:daoId" element={<DAODetailPage />} />
              <Route
                path="/dao/:daoId/agents/:agentId/edit"
                element={<AgentEditPage />}
              />
              <Route
                path="/dao/:daoId/proposal/:proposalId"
                element={<ProposalPage />}
              />
              <Route
                path="/dao/:daoId/proposals/:proposalId"
                element={<ProposalDetailPage />}
              />
              <Route path="/my-daos" element={<MyDAOsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/moderation" element={<ModerationPage />} />
              <Route path="/bug-bounty" element={<BugBountyPage />} />
              <Route
                path="/bug-bounty/:submissionId"
                element={<BugBountyDetailPage />}
              />
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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
