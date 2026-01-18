import { AuthProvider } from '@jejunetwork/auth'
import { LoginModal, useJejuAuth } from '@jejunetwork/auth/react'
import {
  Activity,
  Book,
  ChevronRight,
  Droplet,
  Factory,
  type LucideIcon,
  Menu,
  Radio,
  Server,
  Shield,
  Sparkles,
  Waves,
  X,
  Zap,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAccount } from 'wagmi'
import MultiTokenBalanceDisplay from './MultiTokenBalanceDisplay'
import { ThemeToggle } from './ThemeProvider'

interface NavItem {
  path: string
  icon: LucideIcon
  label: string
  description: string
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Get Started',
    items: [
      {
        path: '/registry',
        icon: Book,
        label: 'Registry',
        description: 'Register identity and browse agents',
      },
      {
        path: '/faucet',
        icon: Droplet,
        label: 'Faucet',
        description: 'Get testnet tokens',
      },
    ],
  },
  {
    title: 'Trade',
    items: [
      {
        path: '/transfer',
        icon: Zap,
        label: 'Bridge',
        description: 'Cross-chain transfers',
      },
      {
        path: '/intents',
        icon: Activity,
        label: 'Intents',
        description: 'Intent-based trading',
      },
    ],
  },
  {
    title: 'Earn',
    items: [
      {
        path: '/liquidity',
        icon: Waves,
        label: 'Liquidity',
        description: 'Provide cross-chain liquidity',
      },
      {
        path: '/nodes',
        icon: Server,
        label: 'Nodes',
        description: 'Run and stake nodes',
      },
      {
        path: '/oracle',
        icon: Radio,
        label: 'Oracle',
        description: 'Price feeds and data',
      },
      {
        path: '/risk',
        icon: Shield,
        label: 'Risk Pools',
        description: 'Insurance and risk allocation',
      },
    ],
  },
  {
    title: 'Build',
    items: [
      {
        path: '/tokens',
        icon: Factory,
        label: 'Tokens',
        description: 'Token registry and management',
      },
      {
        path: '/deploy',
        icon: Factory,
        label: 'Deploy',
        description: 'Deploy paymasters',
      },
    ],
  },
]

// Flat list for mobile navigation
const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items)

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { authenticated, loading, walletAddress, logout } = useJejuAuth()
  const { isConnected } = useAccount()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(
    'Get Started',
  )
  const [loginOpen, setLoginOpen] = useState(false)

  const currentPath = location.pathname || '/registry'

  return (
    <div className="layout">
      {/* Header */}
      <header className="header">
        <div className="container header-content">
          <div className="header-brand">
            <Link to="/" className="header-brand-link">
              <Sparkles size={24} />
              <span>Gateway</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="desktop-nav">
            {ALL_NAV_ITEMS.map(({ path, label }) => (
              <Link
                key={path}
                to={path}
                className={`nav-link ${currentPath === path ? 'active' : ''}`}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="header-actions">
            <ThemeToggle />
            {authenticated && walletAddress ? (
              <button
                type="button"
                className="nav-link"
                onClick={() => logout()}
              >
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </button>
            ) : (
              <button
                type="button"
                className="nav-link"
                onClick={() => setLoginOpen(true)}
                disabled={loading}
              >
                {loading ? 'Connecting...' : 'Sign In'}
              </button>
            )}
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Modal overlay pattern - click to close
        <div
          className="mobile-menu-overlay"
          onClick={() => setMobileMenuOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setMobileMenuOpen(false)}
          role="presentation"
        />
      )}

      {/* Mobile Sidebar */}
      <aside className={`mobile-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="mobile-sidebar-header">
          <div className="header-brand">
            <Sparkles size={24} />
            <span>Gateway</span>
          </div>
          <button
            type="button"
            className="mobile-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="mobile-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mobile-nav-group">
              <button
                type="button"
                className="mobile-nav-group-header"
                onClick={() =>
                  setExpandedGroup(
                    expandedGroup === group.title ? null : group.title,
                  )
                }
              >
                <span>{group.title}</span>
                <ChevronRight
                  size={16}
                  className={`chevron ${expandedGroup === group.title ? 'expanded' : ''}`}
                />
              </button>
              <div
                className={`mobile-nav-items ${expandedGroup === group.title ? 'expanded' : ''}`}
              >
                {group.items.map(({ path, icon: Icon, label, description }) => (
                  <Link
                    key={path}
                    to={path}
                    className={`mobile-nav-item ${currentPath === path ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Icon size={20} />
                    <div className="mobile-nav-item-content">
                      <span className="mobile-nav-item-label">{label}</span>
                      <span className="mobile-nav-item-desc">
                        {description}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="container">
          {isConnected && <MultiTokenBalanceDisplay />}
          <div className="page-content animate-fade-in">{children}</div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav">
        {ALL_NAV_ITEMS.slice(0, 5).map(({ path, icon: Icon, label }) => (
          <Link
            key={path}
            to={path}
            className={`bottom-nav-item ${currentPath === path ? 'active' : ''}`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <LoginModal
        isOpen={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={() => setLoginOpen(false)}
        title="Sign In"
        subtitle="Use wallet or passkey"
        providers={[
          AuthProvider.WALLET,
          AuthProvider.PASSKEY,
          AuthProvider.FARCASTER,
          AuthProvider.GOOGLE,
          AuthProvider.GITHUB,
          AuthProvider.TWITTER,
          AuthProvider.DISCORD,
        ]}
        showEmailPhone={false}
      />

      <style>{`
        .layout {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .header-brand-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: inherit;
          text-decoration: none;
          font-weight: 700;
          font-size: 1.25rem;
        }

        .desktop-nav {
          display: none;
          gap: 0.25rem;
        }

        @media (min-width: 1024px) {
          .desktop-nav {
            display: flex;
          }
        }

        .nav-link {
          padding: 0.5rem 0.75rem;
          border-radius: 8px;
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s;
        }

        .nav-link:hover {
          background: var(--surface-hover);
          color: var(--text-primary);
        }

        .nav-link.active {
          background: var(--primary-soft);
          color: var(--primary);
        }

        .mobile-menu-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem;
          border: none;
          background: transparent;
          color: var(--text-primary);
          cursor: pointer;
          border-radius: 8px;
        }

        .mobile-menu-btn:hover {
          background: var(--surface-hover);
        }

        @media (min-width: 1024px) {
          .mobile-menu-btn {
            display: none;
          }
        }

        .mobile-menu-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 40;
          backdrop-filter: blur(4px);
        }

        @media (min-width: 1024px) {
          .mobile-menu-overlay {
            display: none;
          }
        }

        .mobile-sidebar {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          width: 300px;
          max-width: 85vw;
          background: var(--surface);
          z-index: 50;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border);
        }

        .mobile-sidebar.open {
          transform: translateX(0);
        }

        @media (min-width: 1024px) {
          .mobile-sidebar {
            display: none;
          }
        }

        .mobile-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem;
          border-bottom: 1px solid var(--border);
        }

        .mobile-close-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.5rem;
          border: none;
          background: transparent;
          color: var(--text-primary);
          cursor: pointer;
          border-radius: 8px;
        }

        .mobile-close-btn:hover {
          background: var(--surface-hover);
        }

        .mobile-nav {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
        }

        .mobile-nav-group {
          margin-bottom: 0.5rem;
        }

        .mobile-nav-group-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 0.75rem;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
        }

        .mobile-nav-group-header .chevron {
          transition: transform 0.2s;
        }

        .mobile-nav-group-header .chevron.expanded {
          transform: rotate(90deg);
        }

        .mobile-nav-items {
          display: none;
          flex-direction: column;
          gap: 0.25rem;
        }

        .mobile-nav-items.expanded {
          display: flex;
        }

        .mobile-nav-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem;
          border-radius: 8px;
          color: var(--text-primary);
          text-decoration: none;
          transition: all 0.2s;
        }

        .mobile-nav-item:hover {
          background: var(--surface-hover);
        }

        .mobile-nav-item.active {
          background: var(--primary-soft);
          color: var(--primary);
        }

        .mobile-nav-item-content {
          display: flex;
          flex-direction: column;
        }

        .mobile-nav-item-label {
          font-weight: 500;
          font-size: 0.9375rem;
        }

        .mobile-nav-item-desc {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .mobile-nav-item.active .mobile-nav-item-desc {
          color: var(--primary);
          opacity: 0.8;
        }

        .main-content {
          flex: 1;
          padding-top: 1rem;
          padding-bottom: 5rem;
        }

        @media (min-width: 1024px) {
          .main-content {
            padding-bottom: 2rem;
          }
        }

        .page-content {
          min-height: 60vh;
        }

        .mobile-bottom-nav {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-around;
          background: var(--surface);
          border-top: 1px solid var(--border);
          padding: 0.5rem 0;
          padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
          z-index: 30;
        }

        @media (min-width: 1024px) {
          .mobile-bottom-nav {
            display: none;
          }
        }

        .bottom-nav-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          padding: 0.5rem 0.75rem;
          min-height: 44px;
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 0.625rem;
          font-weight: 500;
          transition: all 0.2s;
          min-width: 64px;
        }

        .bottom-nav-item.active {
          color: var(--primary);
        }

        .bottom-nav-item:active {
          transform: scale(0.95);
        }

        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
