import { clsx } from 'clsx'
import {
  Bell,
  Bot,
  Box,
  Brain,
  Briefcase,
  ChevronDown,
  DollarSign,
  GitBranch,
  HelpCircle,
  Home,
  LayoutDashboard,
  Mail,
  Package,
  Play,
  Search,
  Settings,
  Sparkles,
  User,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

interface NavSection {
  name: string
  icon: React.ComponentType<{ className?: string }>
  children: NavItem[]
}

type NavEntry = NavItem | NavSection

const navigation: NavEntry[] = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Messages', href: '/messages', icon: Mail },
  {
    name: 'Work',
    icon: Briefcase,
    children: [
      { name: 'Bounties', href: '/bounties', icon: DollarSign },
      { name: 'Jobs', href: '/jobs', icon: Briefcase },
      { name: 'Projects', href: '/projects', icon: LayoutDashboard },
    ],
  },
  {
    name: 'Code',
    icon: GitBranch,
    children: [
      { name: 'Repositories', href: '/git', icon: GitBranch },
      { name: 'Packages', href: '/packages', icon: Package },
      { name: 'Containers', href: '/containers', icon: Box },
      { name: 'CI/CD', href: '/ci', icon: Play },
    ],
  },
  {
    name: 'AI',
    icon: Brain,
    children: [
      { name: 'Models', href: '/models', icon: Brain },
      { name: 'Agents', href: '/agents', icon: Bot },
    ],
  },
]

const bottomNav: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Help', href: '/help', icon: HelpCircle },
]

function isNavSection(item: NavEntry): item is NavSection {
  return 'children' in item
}

export function Navigation() {
  const location = useLocation()
  const [expanded, setExpanded] = useState<string[]>(['Work', 'Code', 'AI'])

  const toggleExpanded = useCallback((name: string) => {
    setExpanded((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    )
  }, [])

  const isActive = useCallback(
    (href: string) => {
      if (href === '/') return location.pathname === '/'
      return location.pathname.startsWith(href)
    },
    [location.pathname],
  )

  return (
    <nav
      className="fixed left-0 top-0 bottom-0 w-64 bg-surface-950/98 backdrop-blur-md border-r border-surface-800/60 flex flex-col z-30"
      aria-label="Main navigation"
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-factory-500 via-accent-500 to-transparent" />

      {/* Logo */}
      <div className="p-5 border-b border-surface-800/50">
        <Link
          to="/"
          className="flex items-center gap-3 group"
          aria-label="Factory - Go to home"
        >
          <div
            className="w-10 h-10 bg-gradient-to-br from-factory-500 to-accent-500 flex items-center justify-center shadow-glow transition-all group-hover:shadow-glow-lg"
            style={{ clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)' }}
          >
            <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <h1 className="font-bold text-lg text-surface-50 font-display tracking-wider uppercase">
            Factory
          </h1>
        </Link>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="SEARCH..."
            aria-label="Search Factory"
            className="w-full pl-10 pr-12 py-2.5 bg-surface-900/80 border border-surface-700 border-l-[3px] border-l-surface-600 text-sm text-surface-200 placeholder-surface-500 placeholder:text-xs placeholder:tracking-widest focus:outline-none focus:border-factory-500 focus:border-l-factory-400 focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-surface-500 bg-surface-800 px-1.5 py-0.5 font-mono border border-surface-700">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4">
        <ul className="space-y-1">
          {navigation.map((item) => (
            <li key={item.name}>
              {isNavSection(item) ? (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.name)}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold transition-all uppercase tracking-wider',
                      'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50',
                    )}
                    aria-expanded={expanded.includes(item.name)}
                    aria-controls={`nav-section-${item.name}`}
                  >
                    <span className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" aria-hidden="true" />
                      {item.name}
                    </span>
                    <ChevronDown
                      className={clsx(
                        'w-4 h-4 transition-transform duration-200',
                        expanded.includes(item.name) && 'rotate-180',
                      )}
                      aria-hidden="true"
                    />
                  </button>

                  <ul
                    id={`nav-section-${item.name}`}
                    className={clsx(
                      'mt-1 ml-2 space-y-0.5 overflow-hidden transition-all duration-200',
                      expanded.includes(item.name)
                        ? 'max-h-96 opacity-100'
                        : 'max-h-0 opacity-0',
                    )}
                  >
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          to={child.href}
                          className={clsx(
                            'relative flex items-center gap-3 px-3 py-2 text-sm transition-all uppercase tracking-wide',
                            isActive(child.href)
                              ? 'bg-factory-500/10 text-factory-400 font-semibold before:absolute before:left-0 before:top-[15%] before:bottom-[15%] before:w-[3px] before:bg-factory-500'
                              : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50 hover:before:absolute hover:before:left-0 hover:before:top-[25%] hover:before:bottom-[25%] hover:before:w-[2px] hover:before:bg-surface-500',
                          )}
                          aria-current={isActive(child.href) ? 'page' : undefined}
                        >
                          <child.icon className="w-4 h-4" aria-hidden="true" />
                          {child.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Link
                  to={item.href}
                  className={clsx(
                    'relative flex items-center gap-3 px-3 py-2.5 text-sm font-semibold transition-all uppercase tracking-wider',
                    isActive(item.href)
                      ? 'bg-factory-500/10 text-factory-400 before:absolute before:left-0 before:top-[15%] before:bottom-[15%] before:w-[3px] before:bg-factory-500'
                      : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50',
                  )}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  <item.icon className="w-5 h-5" aria-hidden="true" />
                  {item.name}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom Navigation */}
      <div className="border-t border-surface-800/50 px-3 py-3">
        <ul className="space-y-1">
          {bottomNav.map((item) => (
            <li key={item.name}>
              <Link
                to={item.href}
                className={clsx(
                  'relative flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all uppercase tracking-wide',
                  isActive(item.href)
                    ? 'bg-factory-500/10 text-factory-400 before:absolute before:left-0 before:top-[20%] before:bottom-[20%] before:w-[3px] before:bg-factory-500'
                    : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50',
                )}
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                <item.icon className="w-5 h-5" aria-hidden="true" />
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* User section */}
      <div className="border-t border-surface-800/50 p-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 bg-gradient-to-br from-surface-700 to-surface-800 flex items-center justify-center border border-surface-600"
            style={{ clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)' }}
          >
            <User className="w-5 h-5 text-surface-400" aria-hidden="true" />
          </div>
          <p className="flex-1 min-w-0 text-sm font-semibold text-surface-100 truncate uppercase tracking-wide">
            Connect Wallet
          </p>
          <button
            type="button"
            className="p-2 hover:bg-surface-800 text-surface-400 hover:text-factory-400 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Bottom accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-surface-700 to-transparent" />
    </nav>
  )
}
