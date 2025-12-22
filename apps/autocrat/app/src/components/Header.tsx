import { Menu, Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthButton } from './auth/AuthButton'

export function Header() {
  const location = useLocation()
  const pathname = location.pathname
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  // Close menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [])

  const toggleTheme = () => {
    const newTheme = !isDark
    setIsDark(newTheme)
    document.documentElement.classList.toggle('dark', newTheme)
    localStorage.setItem('autocrat-theme', newTheme ? 'dark' : 'light')
  }

  const navLinks = [
    { href: '/', label: 'Dashboard' },
    { href: '/proposals', label: 'Proposals' },
    { href: '/create', label: 'Create' },
    { href: '/ceo', label: 'CEO' },
  ]

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl border-b"
      style={{
        background: 'rgba(var(--bg-primary-rgb, 248, 250, 252), 0.95)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="container mx-auto px-3 sm:px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl">🏛️</span>
            <span className="font-semibold hidden xs:inline">Autocrat</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  pathname === link.href ? 'bg-gray-100 dark:bg-gray-800' : ''
                }`}
                style={{
                  color:
                    pathname === link.href
                      ? 'var(--color-primary)'
                      : 'var(--text-secondary)',
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <AuthButton />

            {/* Mobile Menu Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <nav
            className="md:hidden py-2 border-t animate-in slide-in-from-top-2 duration-200"
            style={{ borderColor: 'var(--border)' }}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                className={`block px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                  pathname === link.href ? 'bg-gray-100 dark:bg-gray-800' : ''
                }`}
                style={{
                  color:
                    pathname === link.href
                      ? 'var(--color-primary)'
                      : 'var(--text-primary)',
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
