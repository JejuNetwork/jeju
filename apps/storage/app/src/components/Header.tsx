'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { HardDrive, Upload, FolderOpen, Settings, Menu, X, Sun, Moon, LogOut, Wallet } from 'lucide-react'

export function Header() {
  const pathname = usePathname()
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showWalletDropdown, setShowWalletDropdown] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [mounted, setMounted] = useState(false)

  const navItems = [
    { href: '/', label: 'Dashboard', icon: HardDrive },
    { href: '/upload', label: 'Upload', icon: Upload },
    { href: '/files', label: 'Files', icon: FolderOpen },
    { href: '/settings', label: 'Settings', icon: Settings },
  ]

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('storage-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const shouldBeDark = savedTheme ? savedTheme === 'dark' : prefersDark
    setIsDark(shouldBeDark)
    document.documentElement.classList.toggle('dark', shouldBeDark)
  }, [])

  const toggleTheme = () => {
    const newIsDark = !isDark
    setIsDark(newIsDark)
    document.documentElement.classList.toggle('dark', newIsDark)
    localStorage.setItem('storage-theme', newIsDark ? 'dark' : 'light')
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  useEffect(() => {
    setShowMobileMenu(false)
  }, [pathname])

  useEffect(() => {
    document.body.style.overflow = showMobileMenu ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [showMobileMenu])

  if (!mounted) return null

  return (
    <>
      <header 
        className="fixed top-0 left-0 right-0 z-50 border-b transition-colors duration-300"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 md:gap-3 group">
              <div className="relative">
                <div className="text-2xl md:text-3xl group-hover:animate-bounce-subtle">📦</div>
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-storage-success animate-pulse" />
              </div>
              <span className="text-xl md:text-2xl font-bold text-gradient">
                Storage
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      active
                        ? 'bg-storage-primary/15 text-storage-primary'
                        : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon size={18} className={active ? 'text-storage-primary' : ''} />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            {/* Right Side Controls */}
            <div className="flex items-center gap-2">
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-3 rounded-xl transition-all duration-200 active:scale-95"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <Sun size={22} className="text-storage-warning" /> : <Moon size={22} className="text-storage-accent" />}
              </button>

              {/* Wallet - Desktop */}
              <div className="relative hidden md:block">
                {!isConnected ? (
                  <button
                    onClick={() => connect({ connector: injected() })}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Wallet size={18} />
                    <span className="hidden sm:inline">Connect</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowWalletDropdown(!showWalletDropdown)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all duration-200"
                      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    >
                      <div className="w-7 h-7 rounded-full bg-gradient-to-r from-storage-primary to-storage-accent flex items-center justify-center text-xs font-bold text-dark-bg">
                        {address?.slice(2, 4).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium font-mono">
                        {address?.slice(0, 6)}...{address?.slice(-4)}
                      </span>
                      <svg className={`w-4 h-4 transition-transform ${showWalletDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {showWalletDropdown && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowWalletDropdown(false)}
                        />
                        <div 
                          className="absolute right-0 top-full mt-2 w-56 rounded-xl border shadow-lg z-50 overflow-hidden"
                          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                        >
                          <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Connected Wallet</p>
                            <p className="text-sm font-mono mt-1" style={{ color: 'var(--text-primary)' }}>
                              {address?.slice(0, 10)}...{address?.slice(-8)}
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              disconnect()
                              setShowWalletDropdown(false)
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)] text-left"
                          >
                            <LogOut size={18} className="text-storage-error" />
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
                className="lg:hidden p-3 rounded-xl transition-all active:scale-95"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label="Toggle menu"
              >
                {showMobileMenu ? <X size={24} /> : <Menu size={24} />}
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
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        onClick={() => setShowMobileMenu(false)}
      />

      {/* Mobile Menu Panel */}
      <nav
        className={`fixed top-0 right-0 bottom-0 w-[85vw] max-w-[320px] z-50 lg:hidden transition-transform duration-300 ease-out ${
          showMobileMenu ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-col h-full safe-area-inset">
          {/* Mobile Menu Header */}
          <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2">
              <span className="text-2xl">📦</span>
              <span className="text-lg font-bold text-gradient">Storage</span>
            </div>
            <button
              onClick={() => setShowMobileMenu(false)}
              className="p-3 rounded-xl active:scale-95 transition-transform"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
              aria-label="Close menu"
            >
              <X size={22} />
            </button>
          </div>

          {/* Mobile Nav Items */}
          <div className="flex-1 overflow-y-auto py-3">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-4 px-5 py-4 text-base font-semibold transition-all active:scale-[0.98] ${
                    active
                      ? 'bg-storage-primary/10 border-r-4 border-storage-primary'
                      : 'active:bg-[var(--bg-secondary)]'
                  }`}
                  style={{ color: active ? 'var(--color-primary)' : 'var(--text-primary)' }}
                >
                  <div 
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      active ? 'bg-storage-primary/20' : ''
                    }`}
                    style={{ backgroundColor: active ? undefined : 'var(--bg-secondary)' }}
                  >
                    <Icon size={22} className={active ? 'text-storage-primary' : ''} />
                  </div>
                  {item.label}
                </Link>
              )
            })}
          </div>

          {/* Mobile Wallet Section */}
          <div className="p-5 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
            {!isConnected ? (
              <button
                onClick={() => {
                  connect({ connector: injected() })
                  setShowMobileMenu(false)
                }}
                className="btn-primary w-full flex items-center justify-center gap-2 text-base"
              >
                <Wallet size={22} />
                Connect Wallet
              </button>
            ) : (
              <div className="space-y-4">
                <div 
                  className="flex items-center gap-4 p-4 rounded-xl"
                  style={{ backgroundColor: 'var(--surface)' }}
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-storage-primary to-storage-accent flex items-center justify-center text-sm font-bold"
                    style={{ color: 'var(--text-on-primary)' }}
                  >
                    {address?.slice(2, 4).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold font-mono truncate">
                      {address?.slice(0, 10)}...{address?.slice(-6)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-2 h-2 rounded-full bg-storage-success" />
                      <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Connected</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    disconnect()
                    setShowMobileMenu(false)
                  }}
                  className="btn-secondary w-full flex items-center justify-center gap-2 text-base"
                >
                  <LogOut size={20} />
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  )
}

