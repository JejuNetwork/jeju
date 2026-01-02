import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { WagmiProvider } from 'wagmi'

import { CommandPalette } from './components/CommandPalette'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/shared'
import { wagmiConfig } from './config/wagmi'
import {
  AgentDeployPage,
  AgentDetailPage,
  AgentsPage,
} from './pages/agents/index'
import { BountiesPage } from './pages/bounties/index'
import { CIDetailPage, CIPage } from './pages/ci/index'
import {
  ContainerDetailPage,
  ContainerPushPage,
  ContainersPage,
} from './pages/containers/index'
import { GitPage, RepoDetailPage, RepoNewPage } from './pages/git/index'
import { HelpPage } from './pages/Help'
import { HomePage } from './pages/Home'
import { JobsPage } from './pages/jobs/index'
import { MessagesPage } from './pages/Messages'
import {
  ModelDetailPage,
  ModelsPage,
  ModelUploadPage,
} from './pages/models/index'
import {
  PackageDetailPage,
  PackagePublishPage,
  PackagesPage,
} from './pages/packages/index'
import {
  ProjectDetailPage,
  ProjectNewPage,
  ProjectsPage,
} from './pages/projects/index'
import { SettingsPage } from './pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/bounties/*" element={<BountiesPage />} />
                <Route path="/jobs/*" element={<JobsPage />} />
                <Route path="/git" element={<GitPage />} />
                <Route path="/git/new" element={<RepoNewPage />} />
                <Route
                  path="/git/:owner/:name/*"
                  element={<RepoDetailPage />}
                />
                <Route path="/packages" element={<PackagesPage />} />
                <Route
                  path="/packages/publish"
                  element={<PackagePublishPage />}
                />
                <Route
                  path="/packages/:scope/:name"
                  element={<PackageDetailPage />}
                />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/models/upload" element={<ModelUploadPage />} />
                <Route
                  path="/models/:org/:name"
                  element={<ModelDetailPage />}
                />
                <Route path="/containers" element={<ContainersPage />} />
                <Route
                  path="/containers/push"
                  element={<ContainerPushPage />}
                />
                <Route
                  path="/containers/:name/:tag"
                  element={<ContainerDetailPage />}
                />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<ProjectNewPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/ci" element={<CIPage />} />
                <Route path="/ci/:id" element={<CIDetailPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/deploy" element={<AgentDeployPage />} />
                <Route path="/agents/:id" element={<AgentDetailPage />} />
                <Route path="/messages/*" element={<MessagesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/help" element={<HelpPage />} />
              </Routes>
            </Layout>
          </ErrorBoundary>
          <CommandPalette />
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            className: 'bg-surface-900 border-surface-700 text-surface-100',
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
