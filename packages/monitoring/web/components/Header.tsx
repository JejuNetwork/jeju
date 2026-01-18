import { AuthProvider } from '@jejunetwork/auth'
import { LoginModal, useJejuAuth } from '@jejunetwork/auth/react'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './nav'

export function Header() {
  const location = useLocation()
  const [isDark, setIsDark] = useState(true)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const { authenticated, loading, walletAddress, logout } = useJejuAuth()

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('jeju-monitoring-theme')
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark
    setIsDark(shouldBeDark)
    document.documentElement.classList.toggle('dark', shouldBeDark)
  }, [])

  const toggleTheme = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    document.documentElement.classList.toggle('dark', newIsDark)
    localStorage.setItem('jeju-monitoring-theme', newIsDark ? 'dark' : 'light')
  }

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/'
    return location.pathname.startsWith(href)
  }

  useEffect(() => {
    setShowMobileMenu(false)
  }, [])

  useEffect(() => {
    document.body.style.overflow = showMobileMenu ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [showMobileMenu])

  if (!mounted) return null

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 border-b safe-top"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(12px)',
        }}
        data-testid="header"
      >
        <div className="container-app">
          <div className="flex items-center justify-between h-14 md:h-16">
            <Link to="/" className="text-lg md:text-xl font-bold text-gradient">
              Monitoring
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                    style={{
                      color: isActive(item.href)
                        ? 'var(--color-primary)'
                        : 'var(--text-secondary)',
                      backgroundColor: isActive(item.href)
                        ? 'rgba(255, 107, 53, 0.1)'
                        : 'transparent',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            <div className="flex items-center gap-2">
              {authenticated && walletAddress ? (
                <>
                  <span
                    className="hidden md:inline-block text-xs font-medium px-3 py-1 rounded-full"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void logout()
                    }}
                    className="px-3 py-2 text-xs font-medium rounded-xl"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowLogin(true)}
                  disabled={loading}
                  className="px-3 py-2 text-xs font-medium rounded-xl"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  {loading ? 'Loading...' : 'Sign In'}
                </button>
              )}
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                data-testid="theme-toggle"
              >
                {isDark ? (
                  <Sun
                    className="w-5 h-5"
                    style={{ color: 'var(--color-warning)' }}
                  />
                ) : (
                  <Moon
                    className="w-5 h-5"
                    style={{ color: 'var(--color-purple)' }}
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="lg:hidden p-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                {showMobileMenu ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <button
        type="button"
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${
          showMobileMenu ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', border: 'none' }}
        onClick={() => setShowMobileMenu(false)}
        aria-label="Close mobile menu"
      />

      <nav
        className={`fixed top-0 right-0 bottom-0 w-64 z-50 lg:hidden transition-transform duration-300 ${
          showMobileMenu ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-col h-full safe-top safe-bottom">
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="font-bold text-gradient">Menu</span>
            <button
              type="button"
              onClick={() => setShowMobileMenu(false)}
              className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 py-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className="flex items-center gap-3 px-6 py-4 font-medium"
                  style={{
                    color: isActive(item.href)
                      ? 'var(--color-primary)'
                      : 'var(--text-primary)',
                    backgroundColor: isActive(item.href)
                      ? 'rgba(255, 107, 53, 0.1)'
                      : 'transparent',
                  }}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      <LoginModal
        isOpen={showLogin}
        onClose={() => setShowLogin(false)}
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
    </>
  )
}
