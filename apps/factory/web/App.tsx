import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { WagmiProvider } from 'wagmi'

import { Layout } from './components/Layout'
import { wagmiConfig } from './config/wagmi'
import { AgentsPage } from './pages/Agents'
import { BountiesPage } from './pages/Bounties'
import { CIPage } from './pages/CI'
import { ContainersPage } from './pages/Containers'
import { FeedPage } from './pages/Feed'
import { GitPage } from './pages/Git'
import { HomePage } from './pages/Home'
import { JobsPage } from './pages/Jobs'
import { MessagesPage } from './pages/Messages'
import { ModelsPage } from './pages/Models'
import { PackagesPage } from './pages/Packages'
import { ProjectsPage } from './pages/Projects'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/bounties/*" element={<BountiesPage />} />
              <Route path="/jobs/*" element={<JobsPage />} />
              <Route path="/git/*" element={<GitPage />} />
              <Route path="/packages/*" element={<PackagesPage />} />
              <Route path="/models/*" element={<ModelsPage />} />
              <Route path="/containers/*" element={<ContainersPage />} />
              <Route path="/projects/*" element={<ProjectsPage />} />
              <Route path="/ci/*" element={<CIPage />} />
              <Route path="/agents/*" element={<AgentsPage />} />
              <Route path="/feed/*" element={<FeedPage />} />
              <Route path="/messages/*" element={<MessagesPage />} />
            </Routes>
          </Layout>
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            className: 'bg-factory-900 border-factory-700 text-factory-100',
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
