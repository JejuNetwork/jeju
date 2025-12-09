import { Link, useLocation } from 'react-router-dom'
import { Activity, AlertTriangle, Target, Zap, Search } from 'lucide-react'

const navItems = [
  { href: '/', label: 'Dashboard', icon: Activity },
  { href: '/alerts', label: 'Alerts', icon: AlertTriangle },
  { href: '/targets', label: 'Targets', icon: Target },
  { href: '/oif', label: 'OIF', icon: Zap },
  { href: '/query', label: 'Query', icon: Search },
]

export function MobileNav() {
  const location = useLocation()

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/'
    return location.pathname.startsWith(href)
  }

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 lg:hidden border-t safe-bottom"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="grid grid-cols-5 h-16">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          
          return (
            <Link
              key={item.href}
              to={item.href}
              className="flex flex-col items-center justify-center gap-1 transition-colors"
              style={{
                color: active ? 'var(--color-primary)' : 'var(--text-tertiary)',
              }}
            >
              <div 
                className={`p-1.5 rounded-xl transition-all ${active ? 'scale-110' : ''}`}
                style={{
                  backgroundColor: active ? 'rgba(255, 107, 53, 0.15)' : 'transparent',
                }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

