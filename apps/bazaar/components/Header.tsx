'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

export function Header() {
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showPortfolioDropdown, setShowPortfolioDropdown] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [mounted, setMounted] = useState(false)

  const navItems = [
    { href: '/', label: 'Home', icon: '🏠' },
    { href: '/coins', label: 'Coins', icon: '🪙' },
    { href: '/swap', label: 'Swap', icon: '🔄' },
    { href: '/pools', label: 'Pools', icon: '💧' },
    { href: '/markets', label: 'Markets', icon: '📊' },
    { href: '/items', label: 'Items', icon: '🖼️' },
    { href: '/names', label: 'Names', icon: '🏷️' },
  ]

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('bazaar-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark
    setIsDark(shouldBeDark)
    document.documentElement.classList.toggle('dark', shouldBeDark)
  }, [])

  const toggleTheme = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    document.documentElement.classList.toggle('dark', newIsDark)
    localStorage.setItem('bazaar-theme', newIsDark ? 'dark' : 'light')
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  // Close mobile menu on route change
  useEffect(() => {
    setShowMobileMenu(false)
  }, [pathname])

  // Prevent scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = showMobileMenu ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [showMobileMenu])

  if (!mounted) return null

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b transition-colors duration-300"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 md:gap-3 group">
              <div className="text-2xl md:text-3xl group-hover:animate-bounce-subtle">🏝️</div>
              <span className="text-xl md:text-2xl font-bold text-gradient">
                Bazaar
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive(item.href)
                      ? 'bg-bazaar-primary/10 text-bazaar-primary'
                      : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={{ color: isActive(item.href) ? 'var(--color-primary)' : 'var(--text-secondary)' }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right Side Controls */}
            <div className="flex items-center gap-2 md:gap-3">
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-2 md:p-2.5 rounded-xl transition-all duration-200 hover:scale-105"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? '☀️' : '🌙'}
              </button>

              {/* Wallet / Portfolio - Desktop */}
              <div className="relative hidden md:block">
                {!isConnected ? (
                  <button
                    onClick={() => connect({ connector: injected() })}
                    className="btn-primary px-4 md:px-6"
                  >
                    Connect Wallet
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowPortfolioDropdown(!showPortfolioDropdown)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all duration-200"
                      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    >
                      <div className="w-6 h-6 rounded-full bg-gradient-to-r from-bazaar-primary to-bazaar-accent flex items-center justify-center text-xs font-bold text-white">
                        {address?.slice(2, 4).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                      </span>
                      <svg className={`w-4 h-4 transition-transform ${showPortfolioDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {/* Dropdown Menu */}
                    {showPortfolioDropdown && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowPortfolioDropdown(false)}
                        />
                        <div 
                          className="absolute right-0 top-full mt-2 w-56 rounded-xl border shadow-lg z-50 overflow-hidden"
                          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                        >
                          <Link
                            href="/portfolio"
                            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)]"
                            onClick={() => setShowPortfolioDropdown(false)}
                          >
                            <span className="text-xl">📊</span>
                            <span className="font-medium">View Portfolio</span>
                          </Link>
                          <button
                            onClick={() => {
                              disconnect()
                              setShowPortfolioDropdown(false)
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)] text-left border-t"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <span className="text-xl">🚪</span>
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
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="lg:hidden p-2.5 rounded-xl transition-all"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label="Toggle menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {showMobileMenu ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div 
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${
          showMobileMenu ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        onClick={() => setShowMobileMenu(false)}
      />

      {/* Mobile Menu Panel */}
      <nav
        className={`fixed top-0 right-0 bottom-0 w-[280px] z-50 lg:hidden transition-transform duration-300 ease-out ${
          showMobileMenu ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-col h-full">
          {/* Mobile Menu Header */}
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-lg font-bold text-gradient">Menu</span>
            <button
              onClick={() => setShowMobileMenu(false)}
              className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Mobile Nav Items */}
          <div className="flex-1 overflow-y-auto py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-6 py-4 text-base font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-bazaar-primary/10 border-r-4 border-bazaar-primary'
                    : 'hover:bg-[var(--bg-secondary)]'
                }`}
                style={{ color: isActive(item.href) ? 'var(--color-primary)' : 'var(--text-primary)' }}
              >
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {/* Mobile Wallet Section */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
            {!isConnected ? (
              <button
                onClick={() => {
                  connect({ connector: injected() })
                  setShowMobileMenu(false)
                }}
                className="btn-primary w-full"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="space-y-3">
                <div 
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-bazaar-primary to-bazaar-accent flex items-center justify-center text-sm font-bold text-white">
                    {address?.slice(2, 4).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {address?.slice(0, 10)}...{address?.slice(-6)}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Connected</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href="/portfolio"
                    onClick={() => setShowMobileMenu(false)}
                    className="btn-secondary text-center text-sm py-2.5"
                  >
                    Portfolio
                  </Link>
                  <button
                    onClick={() => {
                      disconnect()
                      setShowMobileMenu(false)
                    }}
                    className="btn-secondary text-sm py-2.5"
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
