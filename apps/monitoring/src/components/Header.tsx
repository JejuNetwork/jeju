import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Activity, AlertTriangle, Target, Zap, Search, Sun, Moon, Menu, X } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: Activity },
  { href: '/alerts', label: 'Alerts', icon: AlertTriangle },
  { href: '/targets', label: 'Targets', icon: Target },
  { href: '/oif', label: 'OIF', icon: Zap },
  { href: '/query', label: 'Query', icon: Search },
]

export function Header() {
  const location = useLocation()
  const [isDark, setIsDark] = useState(true)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('jeju-monitoring-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
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
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = showMobileMenu ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
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
      >
        <div className="container-app">
          <div className="flex items-center justify-between h-14 md:h-16">
            <Link to="/" className="text-lg md:text-xl font-bold text-gradient">
              Monitoring
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                    style={{ 
                      color: isActive(item.href) ? 'var(--color-primary)' : 'var(--text-secondary)',
                      backgroundColor: isActive(item.href) ? 'rgba(255, 107, 53, 0.1)' : 'transparent',
                    }}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                {isDark ? <Sun className="w-5 h-5" style={{ color: 'var(--color-warning)' }} /> : <Moon className="w-5 h-5" style={{ color: 'var(--color-purple)' }} />}
              </button>

              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="lg:hidden p-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div 
        className={`fixed inset-0 z-40 lg:hidden transition-opacity duration-300 ${
          showMobileMenu ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        onClick={() => setShowMobileMenu(false)}
      />

      <nav
        className={`fixed top-0 right-0 bottom-0 w-64 z-50 lg:hidden transition-transform duration-300 ${
          showMobileMenu ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ backgroundColor: 'var(--surface)' }}
      >
        <div className="flex flex-col h-full safe-top safe-bottom">
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="font-bold text-gradient">Menu</span>
            <button onClick={() => setShowMobileMenu(false)} className="p-2 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 py-4">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className="flex items-center gap-3 px-6 py-4 font-medium"
                  style={{ 
                    color: isActive(item.href) ? 'var(--color-primary)' : 'var(--text-primary)',
                    backgroundColor: isActive(item.href) ? 'rgba(255, 107, 53, 0.1)' : 'transparent',
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
    </>
  )
}
