import { OAuth3Provider } from '@jejunetwork/auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useMemo } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Header } from './components/Header'
import { LoadingSpinner } from './components/LoadingSpinner'
import { OnboardingModal } from './components/OnboardingModal'
import { getOAuth3Config } from './config'

// Lazy load pages for better performance
const HomePage = lazy(() => import('./pages/Home'))
const AgentsPage = lazy(() => import('./pages/Agents'))
const AgentDetailPage = lazy(() => import('./pages/AgentDetail'))
const CreateAgentPage = lazy(() => import('./pages/CreateAgent'))
const RoomsPage = lazy(() => import('./pages/Rooms'))
const RoomPage = lazy(() => import('./pages/Room'))
const ChatPage = lazy(() => import('./pages/Chat'))
const AutonomousPage = lazy(() => import('./pages/Autonomous'))
const BotsPage = lazy(() => import('./pages/Bots'))
const NotFoundPage = lazy(() => import('./pages/NotFound'))

function PageLoader() {
  return (
    <output className="flex flex-col items-center justify-center py-20">
      <LoadingSpinner size="lg" label="Loading" />
    </output>
  )
}

function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(
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
    [],
  )

  const oauth3Config = useMemo(() => getOAuth3Config(), [])

  return (
    <OAuth3Provider config={oauth3Config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </OAuth3Provider>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 pt-24 md:pt-28 pb-12">
        {children}
      </main>
      <footer
        className="border-t py-8 mt-auto"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">
                🔥
              </span>
              <span className="font-bold text-gradient font-display">
                Crucible
              </span>
            </div>
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
            borderRadius: '0.75rem',
            boxShadow: 'var(--shadow-card)',
          },
        }}
      />
      <OnboardingModal />
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
              <Route path="/rooms" element={<RoomsPage />} />
              <Route path="/rooms/:roomId" element={<RoomPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/chat/:roomId" element={<ChatPage />} />
              <Route path="/autonomous" element={<AutonomousPage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </Providers>
    </BrowserRouter>
  )
}
