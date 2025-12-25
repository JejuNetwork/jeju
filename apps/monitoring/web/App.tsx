import { Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { MobileNav } from './components/MobileNav'
import { Alerts } from './pages/Alerts'
import { Dashboard } from './pages/Dashboard'
import { OIFStats } from './pages/OIFStats'
import { QueryExplorer } from './pages/QueryExplorer'
import { Targets } from './pages/Targets'

export default function App() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen" data-testid="app-root">
        <Header />

        <main
          className="container-app pt-20 md:pt-24 pb-24 md:pb-12"
          data-testid="main-content"
        >
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/targets" element={<Targets />} />
            <Route path="/oif" element={<OIFStats />} />
            <Route path="/query" element={<QueryExplorer />} />
          </Routes>
        </main>

        <MobileNav />

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
    </ErrorBoundary>
  )
}
