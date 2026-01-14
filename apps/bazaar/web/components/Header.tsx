import { useJejuAuth } from '@jejunetwork/auth/react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDisconnect } from 'wagmi'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/swap', label: 'Swap', icon: '🔄' },
  { href: '/pools', label: 'Pools', icon: '💧' },
  { href: '/perps', label: 'Perps', icon: '📈' },
  { href: '/coins', label: 'Coins', icon: '🪙' },
  { href: '/markets', label: 'Predictions', icon: '🔮' },
  { href: '/items', label: 'Items', icon: '🖼️' },
] as const

export function Header() {
  const { pathname } = useLocation()
  const {
    authenticated,
    loading: authLoading,
    walletAddress,
    loginWithWallet,
    logout,
  } = useJejuAuth()
  const { disconnect } = useDisconnect()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [mounted, setMounted] = useState(false)

  // Initialize theme from localStorage/system preference
  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('bazaar-theme')
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark
    setIsDark(shouldBeDark)
    document.documentElement.classList.toggle('dark', shouldBeDark)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
    setAccountDropdownOpen(false)
  }, [])

  // Prevent scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileMenuOpen])

  // Handle escape key to close menus
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false)
        setAccountDropdownOpen(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  const toggleTheme = useCallback(() => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    document.documentElement.classList.toggle('dark', newIsDark)
    localStorage.setItem('bazaar-theme', newIsDark ? 'dark' : 'light')
  }, [isDark])

  const isActive = useCallback(
    (href: string) => {
      if (href === '/') return pathname === '/'
      return pathname.startsWith(href)
    },
    [pathname],
  )

  const handleConnect = useCallback(async () => {
    await loginWithWallet()
  }, [loginWithWallet])

  const handleDisconnect = useCallback(async () => {
    // Disconnect wagmi first to clear connection
    disconnect()
    // Clear wagmi storage
    if (typeof window !== 'undefined' && window.localStorage) {
      const keys = Object.keys(window.localStorage)
      keys.forEach((key) => {
        if (
          key.startsWith('wagmi') ||
          key.startsWith('wc@') ||
          key.includes('connector') ||
          key.includes('wallet')
        ) {
          window.localStorage.removeItem(key)
        }
      })
    }
    // Logout from OAuth3
    await logout()
    setAccountDropdownOpen(false)
    // Reload to ensure clean state
    window.location.reload()
  }, [logout, disconnect])

  if (!mounted) return null

  return (
    <>
      {/* Skip to main content link for keyboard users */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header
        className="fixed top-0 left-0 right-0 z-50 border-b bg-surface/80 backdrop-blur-xl transition-colors duration-300"
        style={{ borderColor: 'var(--border)' }}
      >
        <nav className="container mx-auto px-4" aria-label="Main navigation">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link
              to="/"
              className="flex items-center gap-2 md:gap-3 group focus-ring rounded-xl"
              aria-label="Bazaar - Go to home page"
            >
              <span
                className="text-2xl md:text-3xl group-hover:animate-bounce-subtle"
                aria-hidden="true"
              >
                🏝️
              </span>
              <span className="text-xl md:text-2xl font-bold text-gradient">
                Bazaar
              </span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1" role="menubar">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    role="menuitem"
                    aria-current={active ? 'page' : undefined}
                    className={`
                      px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 focus-ring
                      ${
                        active
                          ? 'bg-primary-soft text-primary-color shadow-glow-sm'
                          : 'text-secondary hover:text-primary hover:bg-surface-secondary'
                      }
                    `}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>

            {/* Right Side Controls */}
            <div className="flex items-center gap-2 md:gap-3">
              {/* Theme Toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 md:p-2.5 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-all duration-200 hover:scale-105 focus-ring"
                aria-label={
                  isDark ? 'Switch to light theme' : 'Switch to dark theme'
                }
              >
                <span className="text-lg" aria-hidden="true">
                  {isDark ? '☀️' : '🌙'}
                </span>
              </button>

              {/* Auth Button - Desktop */}
              <div className="relative hidden md:block">
                {!authenticated || !walletAddress ? (
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={authLoading}
                    className="btn-primary px-4 md:px-6"
                  >
                    {authLoading ? 'Connecting...' : 'Sign In'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setAccountDropdownOpen(!accountDropdownOpen)
                      }
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-all duration-200 focus-ring"
                      aria-expanded={accountDropdownOpen}
                      aria-haspopup="menu"
                    >
                      <div
                        className="w-6 h-6 rounded-full gradient-cool flex items-center justify-center text-xs font-bold text-white"
                        aria-hidden="true"
                      >
                        {walletAddress.slice(2, 4).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-primary">
                        {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                      </span>
                      <svg
                        className={`w-4 h-4 text-secondary transition-transform duration-200 ${
                          accountDropdownOpen ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </button>

                    {/* Account Dropdown */}
                    {accountDropdownOpen && (
                      <>
                        <button
                          type="button"
                          className="fixed inset-0 z-40"
                          onClick={() => setAccountDropdownOpen(false)}
                          aria-label="Close menu"
                        />
                        <div
                          className="absolute right-0 top-full mt-2 w-56 rounded-xl border bg-surface shadow-lg z-50 overflow-hidden animate-scale-in"
                          style={{ borderColor: 'var(--border)' }}
                          role="menu"
                        >
                          <Link
                            to="/portfolio"
                            className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
                            onClick={() => setAccountDropdownOpen(false)}
                            role="menuitem"
                          >
                            <span aria-hidden="true">📊</span>
                            <span className="font-medium">View Portfolio</span>
                          </Link>
                          <Link
                            to="/rewards"
                            className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
                            onClick={() => setAccountDropdownOpen(false)}
                            role="menuitem"
                          >
                            <span aria-hidden="true">🎁</span>
                            <span className="font-medium">Rewards</span>
                          </Link>
                          <Link
                            to="/settings"
                            className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
                            onClick={() => setAccountDropdownOpen(false)}
                            role="menuitem"
                          >
                            <span aria-hidden="true">⚙️</span>
                            <span className="font-medium">Settings</span>
                          </Link>
                          <div
                            className="border-t"
                            style={{ borderColor: 'var(--border)' }}
                          />
                          <button
                            type="button"
                            onClick={handleDisconnect}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors text-left text-error"
                            role="menuitem"
                          >
                            <span aria-hidden="true">🚪</span>
                            <span className="font-medium">Disconnect</span>
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              {/* Mobile Menu Button */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2.5 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-all focus-ring"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-menu"
              >
                <svg
                  className="w-6 h-6 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  {mobileMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${
          mobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!mobileMenuOpen}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close menu"
          tabIndex={mobileMenuOpen ? 0 : -1}
        />
      </div>

      {/* Mobile Menu Panel */}
      <nav
        id="mobile-menu"
        className={`fixed top-0 right-0 bottom-0 w-[300px] max-w-[85vw] z-50 lg:hidden transition-transform duration-300 ease-out bg-surface ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="Mobile navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="flex flex-col h-full">
          {/* Mobile Menu Header */}
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-lg font-bold text-gradient">Menu</span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors focus-ring"
              aria-label="Close menu"
              tabIndex={mobileMenuOpen ? 0 : -1}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Mobile Nav Items */}
          <div className="flex-1 overflow-y-auto py-4">
            {NAV_ITEMS.map((item, index) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`
                    flex items-center gap-3 px-6 py-4 text-base font-medium transition-colors
                    animate-fade-in-up stagger-${index + 1}
                    ${
                      active
                        ? 'bg-primary-soft border-r-4 border-primary-color text-primary-color'
                        : 'hover:bg-surface-secondary text-primary'
                    }
                  `}
                  aria-current={active ? 'page' : undefined}
                  tabIndex={mobileMenuOpen ? 0 : -1}
                  style={{
                    borderColor: active ? 'var(--color-primary)' : undefined,
                  }}
                >
                  <span className="text-xl" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              )
            })}
          </div>

          {/* Mobile Wallet Section */}
          <div
            className="p-4 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            {!authenticated || !walletAddress ? (
              <button
                type="button"
                onClick={handleConnect}
                disabled={authLoading}
                className="btn-primary w-full"
              >
                {authLoading ? 'Connecting...' : 'Sign In'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-secondary">
                  <div className="w-10 h-10 rounded-full gradient-cool flex items-center justify-center text-sm font-bold text-white">
                    {walletAddress.slice(2, 4).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">
                      {walletAddress.slice(0, 10)}...{walletAddress.slice(-6)}
                    </p>
                    <p className="text-xs text-tertiary">Connected</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    to="/portfolio"
                    onClick={() => setMobileMenuOpen(false)}
                    className="btn-secondary text-center text-sm py-2.5"
                    tabIndex={mobileMenuOpen ? 0 : -1}
                  >
                    Portfolio
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      handleDisconnect()
                      setMobileMenuOpen(false)
                    }}
                    className="btn-secondary text-sm py-2.5"
                    tabIndex={mobileMenuOpen ? 0 : -1}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  )
}
