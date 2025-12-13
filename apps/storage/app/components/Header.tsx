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
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      isActive(item.href)
                        ? 'bg-storage-primary/10'
                        : 'hover:bg-[var(--bg-secondary)]'
                    }`}
                    style={{ color: isActive(item.href) ? 'var(--color-primary)' : 'var(--text-secondary)' }}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            {/* Right Side Controls */}
            <div className="flex items-center gap-2 md:gap-3">
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-2.5 md:p-3 rounded-xl transition-all duration-200 hover:scale-105"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <Sun size={20} className="text-storage-warning" /> : <Moon size={20} className="text-storage-accent" />}
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
                className="lg:hidden p-2.5 rounded-xl transition-all"
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
        className={`fixed top-0 right-0 bottom-0 w-[300px] z-50 lg:hidden transition-transform duration-300 ease-out ${
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
              <X size={20} />
            </button>
          </div>

          {/* Mobile Nav Items */}
          <div className="flex-1 overflow-y-auto py-4">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-4 px-6 py-4 text-base font-medium transition-colors ${
                    isActive(item.href)
                      ? 'bg-storage-primary/10 border-r-4 border-storage-primary'
                      : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={{ color: isActive(item.href) ? 'var(--color-primary)' : 'var(--text-primary)' }}
                >
                  <Icon size={22} />
                  {item.label}
                </Link>
              )
            })}
          </div>

          {/* Mobile Wallet Section */}
          <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
            {!isConnected ? (
              <button
                onClick={() => {
                  connect({ connector: injected() })
                  setShowMobileMenu(false)
                }}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Wallet size={20} />
                Connect Wallet
              </button>
            ) : (
              <div className="space-y-3">
                <div 
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div className="w-12 h-12 rounded-full bg-gradient-to-r from-storage-primary to-storage-accent flex items-center justify-center text-sm font-bold text-dark-bg">
                    {address?.slice(2, 4).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium font-mono truncate">
                      {address?.slice(0, 10)}...{address?.slice(-6)}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Connected</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    disconnect()
                    setShowMobileMenu(false)
                  }}
                  className="btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <LogOut size={18} />
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






