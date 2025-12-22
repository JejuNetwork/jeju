/**
 * Bazaar App Component
 *
 * Main application component with routing and providers
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Lazy load pages for better performance
import { lazy, Suspense, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { WagmiProvider } from 'wagmi'
import { Header } from '../components/Header'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { chainId, rpcUrl, wagmiConfig } from '../config/wagmi'
import { BanCheckWrapper } from './components/BanCheckWrapper'
import { OAuth3Provider } from './providers/OAuth3Provider'

const HomePage = lazy(() => import('./pages/Home'))
const SwapPage = lazy(() => import('./pages/Swap'))
const PoolsPage = lazy(() => import('./pages/Pools'))
const PerpsPage = lazy(() => import('./pages/Perps'))
const ChartsPage = lazy(() => import('./pages/Charts'))
const ChartDetailPage = lazy(() => import('./pages/ChartDetail'))
const IntelPage = lazy(() => import('./pages/Intel'))
const CoinsPage = lazy(() => import('./pages/Coins'))
const CoinDetailPage = lazy(() => import('./pages/CoinDetail'))
const CoinCreatePage = lazy(() => import('./pages/CoinCreate'))
const CoinLaunchPage = lazy(() => import('./pages/CoinLaunch'))
const JejuICOPage = lazy(() => import('./pages/JejuICO'))
const JejuWhitepaperPage = lazy(() => import('./pages/JejuWhitepaper'))
const BblnICOPage = lazy(() => import('./pages/BblnICO'))
const MarketsPage = lazy(() => import('./pages/Markets'))
const MarketDetailPage = lazy(() => import('./pages/MarketDetail'))
const ItemsPage = lazy(() => import('./pages/Items'))
const ItemDetailPage = lazy(() => import('./pages/ItemDetail'))
const ItemMintPage = lazy(() => import('./pages/ItemMint'))
const FaucetPage = lazy(() => import('./pages/Faucet'))
const GamesPage = lazy(() => import('./pages/Games'))
const HyperscapePage = lazy(() => import('./pages/Hyperscape'))
const NamesPage = lazy(() => import('./pages/Names'))
const LiquidityPage = lazy(() => import('./pages/Liquidity'))
const TFMMPage = lazy(() => import('./pages/TFMM'))
const PortfolioPage = lazy(() => import('./pages/Portfolio'))
const AuthCallbackPage = lazy(() => import('./pages/AuthCallback'))
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
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OAuth3Provider
          config={{
            appId: 'bazaar.apps.jeju',
            redirectUri: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
            chainId,
            rpcUrl,
          }}
        >
          {children}
        </OAuth3Provider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 pt-24 md:pt-28 pb-12">
        <BanCheckWrapper>{children}</BanCheckWrapper>
      </main>
      <footer
        className="border-t py-8 mt-16"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🏝️</span>
              <span className="font-bold text-gradient">Bazaar</span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Powered by the network
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
              <Route path="/swap" element={<SwapPage />} />
              <Route path="/pools" element={<PoolsPage />} />
              <Route path="/perps" element={<PerpsPage />} />
              <Route path="/charts" element={<ChartsPage />} />
              <Route path="/charts/:address" element={<ChartDetailPage />} />
              <Route path="/intel" element={<IntelPage />} />
              <Route path="/coins" element={<CoinsPage />} />
              <Route path="/coins/create" element={<CoinCreatePage />} />
              <Route path="/coins/launch" element={<CoinLaunchPage />} />
              <Route path="/coins/jeju-ico" element={<JejuICOPage />} />
              <Route
                path="/coins/jeju-ico/whitepaper"
                element={<JejuWhitepaperPage />}
              />
              <Route path="/coins/bbln-ico" element={<BblnICOPage />} />
              <Route
                path="/coins/:chainId/:address"
                element={<CoinDetailPage />}
              />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/markets/:id" element={<MarketDetailPage />} />
              <Route path="/items" element={<ItemsPage />} />
              <Route path="/items/mint" element={<ItemMintPage />} />
              <Route path="/items/:id" element={<ItemDetailPage />} />
              <Route path="/faucet" element={<FaucetPage />} />
              <Route path="/games" element={<GamesPage />} />
              <Route path="/games/hyperscape" element={<HyperscapePage />} />
              <Route path="/names" element={<NamesPage />} />
              <Route path="/liquidity" element={<LiquidityPage />} />
              <Route path="/tfmm" element={<TFMMPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </Layout>
      </Providers>
    </BrowserRouter>
  )
}
