/**
 * Crucible App Component
 *
 * Main application component with routing and providers
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from './components/Header'
import { LoadingSpinner } from './components/LoadingSpinner'

// Lazy load pages for better performance
const HomePage = lazy(() => import('./pages/Home'))
const AgentsPage = lazy(() => import('./pages/Agents'))
const AgentDetailPage = lazy(() => import('./pages/AgentDetail'))
const CreateAgentPage = lazy(() => import('./pages/CreateAgent'))
const ChatPage = lazy(() => import('./pages/Chat'))
const NotFoundPage = lazy(() => import('./pages/NotFound'))

function PageLoader() {
  return (
    <div className="flex justify-center py-20">
      <LoadingSpinner size="lg" />
    </div>
  )
}

function Providers({ children }: { children: React.ReactNode }) {
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 pt-24 md:pt-28 pb-12">
        {children}
      </main>
      <footer
        className="border-t py-8 mt-16"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔥</span>
              <span className="font-bold text-gradient">Crucible</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Decentralized Agent Orchestration Platform
            </p>
          </div>
        </div>
      </footer>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <Layout>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/new" element={<CreateAgentPage />} />
              <Route path="/agents/:id" element={<AgentDetailPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/chat/:roomId" element={<ChatPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </Providers>
    </BrowserRouter>
  )
}
