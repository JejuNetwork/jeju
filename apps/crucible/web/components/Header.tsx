/**
 * Header Component
 */

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useHealth } from '../hooks'

export function Header() {
  const { pathname } = useLocation()
  const { data: health } = useHealth()
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [isDark, setIsDark] = useState(true)
  const [mounted, setMounted] = useState(false)

  const navItems = [
    { href: '/', label: 'Home', icon: '🏠' },
    { href: '/agents', label: 'Agents', icon: '🤖' },
    { href: '/characters', label: 'Characters', icon: '👤' },
    { href: '/chat', label: 'Chat', icon: '💬' },
    { href: '/rooms', label: 'Rooms', icon: '🏛️' },
    { href: '/autonomous', label: 'Autonomous', icon: '⚡' },
  ]

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('crucible-theme')
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
    localStorage.setItem('crucible-theme', newIsDark ? 'dark' : 'light')
  }

  const isActive = (href: string) => {
    if (!pathname) return false
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
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
        className="fixed top-0 left-0 right-0 z-50 border-b transition-colors duration-300"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 md:gap-3 group">
              <div className="text-2xl md:text-3xl group-hover:animate-bounce-subtle">
                🔥
              </div>
              <span className="text-xl md:text-2xl font-bold text-gradient">
                Crucible
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive(item.href)
                      ? 'bg-crucible-primary/10'
                      : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={{
                    color: isActive(item.href)
                      ? 'var(--color-primary)'
                      : 'var(--text-secondary)',
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right Side Controls */}
            <div className="flex items-center gap-2 md:gap-3">
              {/* Status Indicator */}
              <div
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div
                  className={`w-2 h-2 rounded-full ${health?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{
                    boxShadow:
                      health?.status === 'healthy'
                        ? '0 0 8px rgba(16, 185, 129, 0.6)'
                        : '0 0 8px rgba(239, 68, 68, 0.6)',
                  }}
                />
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {health?.network ?? 'Connecting...'}
                </span>
              </div>

              {/* Theme Toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 md:p-2.5 rounded-xl transition-all duration-200 hover:scale-105"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label={
                  isDark ? 'Switch to light mode' : 'Switch to dark mode'
                }
              >
                {isDark ? '☀️' : '🌙'}
              </button>

              {/* Mobile Menu Button */}
              <button
                type="button"
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="lg:hidden p-2.5 rounded-xl transition-all"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
                aria-label="Toggle menu"
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

      {/* Mobile Menu Overlay */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${
          showMobileMenu ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      >
        <button
          type="button"
          className="absolute inset-0 cursor-default"
          onClick={() => setShowMobileMenu(false)}
          aria-label="Close mobile menu"
        />
      </div>

      {/* Mobile Menu Panel */}
      <nav
        className={`fixed top-0 right-0 bottom-0 w-[280px] z-50 lg:hidden transition-transform duration-300 ease-out ${
          showMobileMenu ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-col h-full">
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-lg font-bold text-gradient">Menu</span>
            <button
              type="button"
              onClick={() => setShowMobileMenu(false)}
              className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
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
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setShowMobileMenu(false)}
                className={`flex items-center gap-3 px-6 py-4 text-base font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-crucible-primary/10 border-r-4 border-crucible-primary'
                    : 'hover:bg-[var(--bg-secondary)]'
                }`}
                style={{
                  color: isActive(item.href)
                    ? 'var(--color-primary)'
                    : 'var(--text-primary)',
                }}
              >
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </div>

          {/* Status */}
          <div
            className="p-4 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div
                className={`w-3 h-3 rounded-full ${health?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <div>
                <p className="text-sm font-medium">
                  {health?.status === 'healthy' ? 'Connected' : 'Disconnected'}
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {health?.network ?? 'Unknown'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </>
  )
}
