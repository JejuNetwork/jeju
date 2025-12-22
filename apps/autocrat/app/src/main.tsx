import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { Layout } from './components/Layout'
import { wagmiConfig } from './config/wagmi'
import './app/globals.css'

import AuthCallbackPage from './pages/AuthCallback'
import BugBountyPage from './pages/BugBounty'
import CEOPage from './pages/CEO'
import CreatePage from './pages/Create'
// Pages
import DashboardPage from './pages/Dashboard'
import ProposalsPage from './pages/Proposals'

function App() {
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
    <StrictMode>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/proposals" element={<ProposalsPage />} />
                <Route path="/create" element={<CreatePage />} />
                <Route path="/ceo" element={<CEOPage />} />
                <Route path="/bug-bounty" element={<BugBountyPage />} />
                <Route path="/auth/callback" element={<AuthCallbackPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
}
