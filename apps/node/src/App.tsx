import { useEffect } from 'react';
import { useAppStore } from './store';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { Services } from './components/Services';
import { Bots } from './components/Bots';
import { Earnings } from './components/Earnings';
import { Staking } from './components/Staking';
import { Settings } from './components/Settings';
import { WalletView } from './components/WalletView';
import { LoadingScreen } from './components/LoadingScreen';
import { ErrorBanner } from './components/ErrorBanner';
import { BanWarning } from './components/BanWarning';

export function App() {
  const { currentView, isLoading, loadingMessage, error, banStatus, initialize } = useAppStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading && !currentView) {
    return <LoadingScreen message={loadingMessage} />;
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard />;
      case 'services':
        return <Services />;
      case 'bots':
        return <Bots />;
      case 'earnings':
        return <Earnings />;
      case 'staking':
        return <Staking />;
      case 'settings':
        return <Settings />;
      case 'wallet':
        return <WalletView />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-volcanic-950">
      <Sidebar />
      
      <main className="flex-1 overflow-auto">
        {error && <ErrorBanner />}
        {banStatus?.is_banned && <BanWarning />}
        
        <div className="p-6">
          {isLoading && (
            <div className="fixed inset-0 bg-volcanic-950/80 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="card p-8 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-jeju-500 mx-auto mb-4" />
                <p className="text-volcanic-300">{loadingMessage}</p>
              </div>
            </div>
          )}
          
          {renderView()}
        </div>
      </main>
    </div>
  );
}

