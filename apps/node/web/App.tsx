import { useEffect } from 'react'
import { BanWarning } from './components/BanWarning'
import { Bots } from './components/Bots'
import { Dashboard } from './components/Dashboard'
import { Earnings } from './components/Earnings'
import { ErrorBanner } from './components/ErrorBanner'
import { LoadingScreen } from './components/LoadingScreen'
import { Services } from './components/Services'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { Staking } from './components/Staking'
import { WalletView } from './components/WalletView'
import { useAppStore } from './context/AppContext'

export function App() {
  const {
    currentView,
    isLoading,
    loadingMessage,
    error,
    banStatus,
    initialize,
  } = useAppStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  if (isLoading && !currentView) {
    return <LoadingScreen message={loadingMessage} />
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />
      case 'services':
        return <Services />
      case 'bots':
        return <Bots />
      case 'earnings':
        return <Earnings />
      case 'staking':
        return <Staking />
      case 'settings':
        return <Settings />
      case 'wallet':
        return <WalletView />
      default:
        return <Dashboard />
    }
  }

  return (
    <div className="flex h-screen bg-volcanic-950">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        {error && <ErrorBanner />}
        {banStatus?.is_banned && <BanWarning />}

        <div className="p-4 sm:p-6 lg:p-8 pt-16 lg:pt-6">
          {isLoading && (
            <div className="fixed inset-0 bg-volcanic-950/80 backdrop-blur-sm z-40 flex items-center justify-center">
              <div className="card p-8 text-center max-w-sm mx-4">
                <div className="relative w-14 h-14 mx-auto mb-4">
                  <div className="absolute inset-0 rounded-full border-2 border-jeju-500/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-jeju-500 animate-spin" />
                </div>
                <p className="text-volcanic-300 text-sm">{loadingMessage}</p>
              </div>
            </div>
          )}

          {renderView()}
        </div>
      </main>
    </div>
  )
}
