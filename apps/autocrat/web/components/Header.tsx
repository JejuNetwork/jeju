import { AuthProvider } from '@jejunetwork/auth'
import { LoginModal, useJejuAuth } from '@jejunetwork/auth/react'
import {
  Building2,
  Menu,
  Moon,
  Plus,
  Sparkles,
  Sun,
  User,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('autocrat-theme')
      if (stored === 'dark' || stored === 'light') return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    return 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    localStorage.setItem('autocrat-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  return { theme, toggleTheme }
}

interface NavLink {
  to: string
  label: string
  icon: typeof Building2
}

const NAV_LINKS: NavLink[] = [
  { to: '/', label: 'Organizations', icon: Building2 },
]

export function Header() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { theme, toggleTheme } = useTheme()

  const { authenticated, loading: authLoading, walletAddress, logout } =
    useJejuAuth()

  const handleDisconnect = useCallback(async () => {
    await logout()
  }, [logout])

  const formatAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [])

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [mobileMenuOpen])

  // Trap focus in mobile menu
  useEffect(() => {
    if (mobileMenuOpen && mobileMenuRef.current) {
      const focusableElements = mobileMenuRef.current.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const firstElement = focusableElements[0] as HTMLElement
      firstElement?.focus()
    }
  }, [mobileMenuOpen])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  return (
    <header
      className="sticky top-0 z-50 backdrop-blur-xl border-b transition-colors duration-200"
      style={{
        backgroundColor: 'rgba(var(--bg-primary-rgb, 250, 251, 255), 0.95)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="container mx-auto">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded-lg p-1 -m-1"
            style={
              {
                '--tw-ring-color': 'var(--color-primary)',
              } as React.CSSProperties
            }
            aria-label="Autocrat - Home"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <span
              className="hidden sm:block font-bold text-lg"
              style={{ color: 'var(--text-primary)' }}
            >
              Autocrat
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav
            className="hidden md:flex items-center gap-2"
            aria-label="Main navigation"
          >
            {NAV_LINKS.map((link) => {
              const Icon = link.icon
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2"
                  style={
                    {
                      backgroundColor: isActive
                        ? 'rgba(6, 214, 160, 0.12)'
                        : 'transparent',
                      color: isActive
                        ? 'var(--color-primary)'
                        : 'var(--text-secondary)',
                      '--tw-ring-color': 'var(--color-primary)',
                    } as React.CSSProperties
                  }
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {link.label}
                </Link>
              )
            })}
          </nav>

          {/* Right Section */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2"
              style={
                {
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  '--tw-ring-color': 'var(--color-primary)',
                } as React.CSSProperties
              }
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Sun className="w-5 h-5" aria-hidden="true" />
              )}
            </button>

            {/* Create DAO Button - Desktop */}
            <Link
              to="/create"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={
                {
                  background: 'var(--gradient-primary)',
                  '--tw-ring-color': 'var(--color-primary)',
                } as React.CSSProperties
              }
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Create DAO
            </Link>

            {/* Wallet Connection */}
            {authenticated && walletAddress ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/my-daos"
                  className="p-2.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2"
                  style={
                    {
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-secondary)',
                      '--tw-ring-color': 'var(--color-primary)',
                    } as React.CSSProperties
                  }
                  aria-label="My DAOs"
                >
                  <User className="w-5 h-5" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2"
                  style={
                    {
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      '--tw-ring-color': 'var(--color-primary)',
                    } as React.CSSProperties
                  }
                >
                  <Wallet className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {formatAddress(walletAddress)}
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                disabled={authLoading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 disabled:opacity-60"
                style={
                  {
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    '--tw-ring-color': 'var(--color-primary)',
                  } as React.CSSProperties
                }
              >
                <Wallet className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {authLoading ? 'Connecting...' : 'Sign In'}
                </span>
                <span className="sm:hidden">
                  {authLoading ? '...' : 'Sign In'}
                </span>
              </button>
            )}

            {/* Mobile Menu Toggle */}
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2"
              style={
                {
                  backgroundColor: mobileMenuOpen
                    ? 'var(--bg-secondary)'
                    : 'transparent',
                  color: 'var(--text-primary)',
                  '--tw-ring-color': 'var(--color-primary)',
                } as React.CSSProperties
              }
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Menu className="w-5 h-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          id="mobile-menu"
          className="md:hidden border-t animate-in"
          style={{
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border)',
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          <nav
            className="container mx-auto py-4 space-y-1"
            aria-label="Mobile navigation"
          >
            {NAV_LINKS.map((link) => {
              const Icon = link.icon
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors"
                  style={{
                    backgroundColor: isActive
                      ? 'rgba(6, 214, 160, 0.12)'
                      : 'transparent',
                    color: isActive
                      ? 'var(--color-primary)'
                      : 'var(--text-primary)',
                  }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  {link.label}
                </Link>
              )
            })}

            {/* Create DAO - Mobile */}
            <Link
              to="/create"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-white mt-2"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <Plus className="w-5 h-5" aria-hidden="true" />
              Create DAO
            </Link>
          </nav>
        </div>
      )}

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
    </header>
  )
}
