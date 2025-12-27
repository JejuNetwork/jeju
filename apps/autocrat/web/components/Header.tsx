/**
 * Autocrat Header Component
 *
 * Bright, accessible navigation header with mobile-friendly design.
 */

import { Building2, Menu, Plus, Sparkles, User, Wallet, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

interface NavLink {
  to: string
  label: string
  icon: typeof Building2
  description: string
}

const NAV_LINKS: NavLink[] = [
  {
    to: '/',
    label: 'Organizations',
    icon: Building2,
    description: 'Browse all DAOs',
  },
]

export function Header() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const { address, isConnected } = useAccount()
  const { connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  const handleConnect = useCallback(() => {
    connect({ connector: injected() })
  }, [connect])

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

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
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
            style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
            aria-label="Autocrat - Home"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
                Autocrat
              </span>
              <span
                className="block text-xs font-medium"
                style={{ color: 'var(--text-tertiary)' }}
              >
                AI Governance
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-2" aria-label="Main navigation">
            {NAV_LINKS.map((link) => {
              const Icon = link.icon
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2"
                  style={{
                    backgroundColor: isActive ? 'rgba(6, 214, 160, 0.12)' : 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--text-secondary)',
                    '--tw-ring-color': 'var(--color-primary)',
                  } as React.CSSProperties}
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
            {/* Create DAO Button - Desktop */}
            <Link
              to="/create"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                background: 'var(--gradient-primary)',
                '--tw-ring-color': 'var(--color-primary)',
              } as React.CSSProperties}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Create DAO
            </Link>

            {/* Wallet Connection */}
            {isConnected && address ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/my-daos"
                  className="p-2.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2"
                  style={{
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-secondary)',
                    '--tw-ring-color': 'var(--color-primary)',
                  } as React.CSSProperties}
                  aria-label="My DAOs"
                >
                  <User className="w-5 h-5" aria-hidden="true" />
                </Link>
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2"
                  style={{
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    '--tw-ring-color': 'var(--color-primary)',
                  } as React.CSSProperties}
                >
                  <Wallet className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{formatAddress(address)}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isPending}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 disabled:opacity-60"
                style={{
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  '--tw-ring-color': 'var(--color-primary)',
                } as React.CSSProperties}
              >
                <Wallet className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isPending ? 'Connecting...' : 'Connect Wallet'}
                </span>
                <span className="sm:hidden">{isPending ? '...' : 'Connect'}</span>
              </button>
            )}

            {/* Mobile Menu Toggle */}
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2"
              style={{
                backgroundColor: mobileMenuOpen ? 'var(--bg-secondary)' : 'transparent',
                color: 'var(--text-primary)',
                '--tw-ring-color': 'var(--color-primary)',
              } as React.CSSProperties}
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
          <nav className="container mx-auto py-4 space-y-1" aria-label="Mobile navigation">
            {NAV_LINKS.map((link) => {
              const Icon = link.icon
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl font-medium transition-colors"
                  style={{
                    backgroundColor: isActive ? 'rgba(6, 214, 160, 0.12)' : 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--text-primary)',
                  }}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor: isActive
                        ? 'rgba(6, 214, 160, 0.15)'
                        : 'var(--bg-secondary)',
                    }}
                  >
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <span className="block">{link.label}</span>
                    <span
                      className="block text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {link.description}
                    </span>
                  </div>
                </Link>
              )
            })}

            {/* Create DAO - Mobile */}
            <Link
              to="/create"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-white mt-3"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.2)' }}
              >
                <Plus className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <span className="block">Create DAO</span>
                <span className="block text-xs opacity-80">
                  Deploy a new organization
                </span>
              </div>
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
