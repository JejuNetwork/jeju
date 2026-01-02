/**
 * Bazaar App Component
 *
 * Main application component with routing and providers
 */

import { OAuth3Provider } from '@jejunetwork/auth/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { WagmiProvider } from 'wagmi'
import { BanCheckWrapper } from './components/BanCheckWrapper'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { chainId, rpcUrl, wagmiConfig } from './config/wagmi'
import AuthCallbackPage from './pages/AuthCallback'
import CoinCreatePage from './pages/CoinCreate'
import CoinDetailPage from './pages/CoinDetail'
import CoinLaunchPage from './pages/CoinLaunch'
import CoinsPage from './pages/Coins'
// Direct imports for dev mode (no code splitting)
import HomePage from './pages/Home'
import ItemDetailPage from './pages/ItemDetail'
import ItemMintPage from './pages/ItemMint'
import ItemsPage from './pages/Items'
import JejuICOPage from './pages/JejuICO'
import JejuWhitepaperPage from './pages/JejuWhitepaper'
import LiquidityPage from './pages/Liquidity'
import MarketCreatePage from './pages/MarketCreate'
import MarketDetailPage from './pages/MarketDetail'
import MarketsPage from './pages/Markets'
import NamesPage from './pages/Names'
import NotFoundPage from './pages/NotFound'
import PerpsPage from './pages/Perps'
import PerpsDetailPage from './pages/PerpsDetail'
import PoolsPage from './pages/Pools'
import PortfolioPage from './pages/Portfolio'
import PredictionDetailPage from './pages/PredictionDetail'
import ProfileDetailPage from './pages/ProfileDetail'
import RewardsPage from './pages/Rewards'
import SettingsPage from './pages/Settings'
import SharePnLPage from './pages/SharePnL'
import ShareReferralPage from './pages/ShareReferral'
import SwapPage from './pages/Swap'
import TFMMPage from './pages/TFMM'
import TrendingGroupPage from './pages/TrendingGroup'
import TrendingTagPage from './pages/TrendingTag'

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

const FOOTER_LINKS = [
  { label: 'Coins', href: '/coins' },
  { label: 'Markets', href: '/markets' },
  { label: 'Items', href: '/items' },
  { label: 'Rewards', href: '/rewards' },
]

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main
        id="main-content"
        className="flex-1 container mx-auto px-4 pt-24 md:pt-28 pb-12"
      >
        <BanCheckWrapper>{children}</BanCheckWrapper>
      </main>
      <footer
        className="border-t py-8 mt-auto"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Brand */}
            <Link to="/" className="flex items-center gap-2 group">
              <span
                className="text-2xl group-hover:animate-bounce-subtle"
                aria-hidden="true"
              >
                🏝️
              </span>
              <span className="font-bold text-gradient">Bazaar</span>
            </Link>

            {/* Links */}
            <nav aria-label="Footer navigation">
              <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      to={link.href}
                      className="text-sm text-secondary hover:text-primary transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Tagline */}
            <p className="text-sm text-tertiary">Powered by the network</p>
          </div>
        </div>
      </footer>
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'card-static',
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
    <ErrorBoundary>
      <BrowserRouter>
        <Providers>
          <Layout>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/swap" element={<SwapPage />} />
              <Route path="/pools" element={<PoolsPage />} />
              <Route path="/perps" element={<PerpsPage />} />
              <Route path="/coins" element={<CoinsPage />} />
              <Route path="/coins/create" element={<CoinCreatePage />} />
              <Route path="/coins/launch" element={<CoinLaunchPage />} />
              <Route path="/coins/jeju-ico" element={<JejuICOPage />} />
              <Route
                path="/coins/jeju-ico/whitepaper"
                element={<JejuWhitepaperPage />}
              />
              <Route
                path="/coins/:chainId/:address"
                element={<CoinDetailPage />}
              />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/markets/create" element={<MarketCreatePage />} />
              <Route path="/markets/:id" element={<MarketDetailPage />} />
              <Route path="/markets/perps" element={<PerpsPage />} />
              <Route
                path="/markets/perps/:ticker"
                element={<PerpsDetailPage />}
              />
              <Route path="/markets/predictions" element={<MarketsPage />} />
              <Route
                path="/markets/predictions/:id"
                element={<PredictionDetailPage />}
              />
              <Route path="/items" element={<ItemsPage />} />
              <Route path="/items/mint" element={<ItemMintPage />} />
              <Route path="/items/:id" element={<ItemDetailPage />} />
              <Route path="/names" element={<NamesPage />} />
              <Route path="/liquidity" element={<LiquidityPage />} />
              <Route path="/tfmm" element={<TFMMPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/profile/:id" element={<ProfileDetailPage />} />
              <Route path="/rewards" element={<RewardsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/share/pnl/:userId" element={<SharePnLPage />} />
              <Route
                path="/share/referral/:userId"
                element={<ShareReferralPage />}
              />
              <Route path="/trending" element={<TrendingTagPage />} />
              <Route path="/trending/:tag" element={<TrendingTagPage />} />
              <Route path="/trending/group" element={<TrendingGroupPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Layout>
        </Providers>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
