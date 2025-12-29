import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useHealth } from '../hooks'
import { NAV_ITEMS } from '../lib/constants'

export function Header() {
  const { pathname } = useLocation()
  const { data: health } = useHealth()
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const savedTheme = localStorage.getItem('crucible-theme')
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)',
    ).matches
    return savedTheme ? savedTheme === 'dark' : prefersDark
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    setShowMobileMenu(false)
  }, [])

  useEffect(() => {
    document.body.style.overflow = showMobileMenu ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [showMobileMenu])

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const newValue = !prev
      document.documentElement.classList.toggle('dark', newValue)
      localStorage.setItem('crucible-theme', newValue ? 'dark' : 'light')
      return newValue
    })
  }, [])

  const closeMobileMenu = useCallback(() => {
    setShowMobileMenu(false)
  }, [])

  const toggleMobileMenu = useCallback(() => {
    setShowMobileMenu((prev) => !prev)
  }, [])

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const isHealthy = health?.status === 'healthy'

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 border-b glass"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16 md:h-20">
            <Link
              to="/"
              className="flex items-center gap-2 md:gap-3 group"
              aria-label="Crucible"
            >
              <span
                className="text-2xl md:text-3xl transition-transform group-hover:scale-110"
                aria-hidden="true"
              >
                🔥
              </span>
              <span className="text-xl md:text-2xl font-bold text-gradient font-display">
                Crucible
              </span>
            </Link>

            <nav
              className="hidden lg:flex items-center gap-1"
              aria-label="Main"
            >
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive(item.href)
                      ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2 md:gap-3">
              <output
                className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <span
                  className={`w-2 h-2 rounded-full ${isHealthy ? 'status-dot-active' : 'status-dot-error'}`}
                  aria-hidden="true"
                />
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {health?.network ?? 'Connecting'}
                </span>
              </output>

              <button
                type="button"
                onClick={toggleTheme}
                className="icon-btn"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label={isDark ? 'Light mode' : 'Dark mode'}
              >
                <span className="text-lg" aria-hidden="true">
                  {isDark ? '☀️' : '🌙'}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleMobileMenu}
                className="lg:hidden icon-btn"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label={showMobileMenu ? 'Close' : 'Menu'}
                aria-expanded={showMobileMenu}
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  {showMobileMenu ? (
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
        </div>
      </header>

      {showMobileMenu && (
        <div
          className="fixed inset-0 z-40 lg:hidden bg-black/50 backdrop-blur-sm animate-fade-in"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      <nav
        className={`fixed top-0 right-0 bottom-0 w-[280px] z-50 lg:hidden transition-transform duration-300 ease-out ${
          showMobileMenu ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--surface)' }}
        aria-label="Mobile"
        aria-hidden={!showMobileMenu}
      >
        <div className="flex flex-col h-full">
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-lg font-bold text-gradient font-display">
              Menu
            </span>
            <button
              type="button"
              onClick={closeMobileMenu}
              className="icon-btn"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
              aria-label="Close"
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

          <div className="flex-1 overflow-y-auto py-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={closeMobileMenu}
                className={`flex items-center px-6 py-4 text-base font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-[var(--color-primary)]/10 border-r-4 border-[var(--color-primary)] text-[var(--color-primary)]'
                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div
            className="p-4 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <output
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <span
                className={`w-3 h-3 rounded-full flex-shrink-0 ${isHealthy ? 'status-dot-active' : 'status-dot-error'}`}
                aria-hidden="true"
              />
              <p
                className="text-sm font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {health?.network ?? 'Connecting'}
              </p>
            </output>
          </div>
        </div>
      </nav>
    </>
  )
}
