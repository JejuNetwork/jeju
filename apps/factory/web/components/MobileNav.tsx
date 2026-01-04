import { clsx } from 'clsx'
import {
  Bot,
  Box,
  Brain,
  Briefcase,
  DollarSign,
  GitBranch,
  Home,
  LayoutDashboard,
  Mail,
  Menu,
  Package,
  Play,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const navSections = [
  {
    title: 'Main',
    items: [
      { name: 'Home', href: '/', icon: Home },
      { name: 'Messages', href: '/messages', icon: Mail },
    ],
  },
  {
    title: 'Work',
    items: [
      { name: 'Bounties', href: '/bounties', icon: DollarSign },
      { name: 'Jobs', href: '/jobs', icon: Briefcase },
      { name: 'Projects', href: '/projects', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Code',
    items: [
      { name: 'Repositories', href: '/git', icon: GitBranch },
      { name: 'Packages', href: '/packages', icon: Package },
      { name: 'Containers', href: '/containers', icon: Box },
      { name: 'CI/CD', href: '/ci', icon: Play },
    ],
  },
  {
    title: 'AI',
    items: [
      { name: 'Models', href: '/models', icon: Brain },
      { name: 'Agents', href: '/agents', icon: Bot },
    ],
  },
]

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false)
  const { pathname } = useLocation()
  const menuRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // Close menu on route change
  useEffect(() => {
    setIsOpen(false)
  }, [])

  // Prevent scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Focus management
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const firstLink = menuRef.current.querySelector('a')
      firstLink?.focus()
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  const isActive = useCallback(
    (href: string) => {
      if (href === '/') return pathname === '/'
      return pathname.startsWith(href)
    },
    [pathname],
  )

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-surface-950/98 backdrop-blur-md border-b border-surface-800/60">
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-factory-500 via-accent-500 to-transparent" />

        <div className="flex items-center justify-between px-4 h-16">
          <Link
            to="/"
            className="flex items-center gap-2.5 group"
            aria-label="Factory - Home"
          >
            <div
              className="w-9 h-9 bg-gradient-to-br from-factory-500 to-accent-500 flex items-center justify-center shadow-glow transition-transform group-active:scale-95"
              style={{ clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)' }}
            >
              <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <span className="font-bold text-lg text-surface-50 font-display uppercase tracking-wider">
              Factory
            </span>
          </Link>

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-2.5 -mr-2 text-surface-400 hover:text-factory-400 hover:bg-surface-800/50 transition-colors"
            aria-label={isOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isOpen}
            aria-controls="mobile-menu"
          >
            {isOpen ? (
              <X className="w-6 h-6" aria-hidden="true" />
            ) : (
              <Menu className="w-6 h-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={clsx(
          'lg:hidden fixed inset-0 z-40 transition-all duration-200',
          isOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none',
        )}
        aria-hidden={!isOpen}
      >
        {/* Backdrop */}
        <button
          type="button"
          className="absolute inset-0 bg-surface-950/85 backdrop-blur-sm border-0 cursor-default"
          onClick={() => setIsOpen(false)}
          aria-label="Close menu"
          tabIndex={isOpen ? 0 : -1}
        />

        {/* Menu Panel */}
        <nav
          ref={menuRef}
          id="mobile-menu"
          className={clsx(
            'absolute top-16 left-0 bottom-0 w-[280px] bg-surface-900/98 backdrop-blur-lg border-r border-surface-800/60 overflow-y-auto custom-scrollbar transition-transform duration-200 ease-out',
            isOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Mobile navigation"
        >
          {/* Side accent */}
          <div className="absolute top-0 left-0 bottom-0 w-[2px] bg-gradient-to-b from-factory-500 via-accent-500 to-transparent" />

          <div className="p-4 space-y-6">
            {navSections.map((section, sectionIndex) => (
              <div
                key={section.title}
                className="animate-slide-up"
                style={{ animationDelay: `${sectionIndex * 50}ms` }}
              >
                <h3 className="text-[10px] font-bold text-surface-500 uppercase tracking-[0.2em] mb-2 px-3">
                  {section.title}
                </h3>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        className={clsx(
                          'relative flex items-center gap-3 px-3 py-3 text-sm font-semibold uppercase tracking-wider transition-all active:scale-[0.98]',
                          isActive(item.href)
                            ? 'bg-factory-500/10 text-factory-400 before:absolute before:left-0 before:top-[15%] before:bottom-[15%] before:w-[3px] before:bg-factory-500'
                            : 'text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 active:bg-surface-800',
                        )}
                        aria-current={isActive(item.href) ? 'page' : undefined}
                        tabIndex={isOpen ? 0 : -1}
                      >
                        <item.icon className="w-5 h-5" aria-hidden="true" />
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Settings */}
            <div
              className="border-t border-surface-800/50 pt-4 animate-slide-up"
              style={{ animationDelay: `${navSections.length * 50}ms` }}
            >
              <Link
                to="/settings"
                className="relative flex items-center gap-3 px-3 py-3 text-sm font-semibold text-surface-300 hover:text-surface-100 hover:bg-surface-800/50 active:bg-surface-800 transition-all active:scale-[0.98] uppercase tracking-wider"
                tabIndex={isOpen ? 0 : -1}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
                Settings
              </Link>
            </div>
          </div>
        </nav>
      </div>

      {/* Spacer for fixed header */}
      <div className="lg:hidden h-16" aria-hidden="true" />
    </>
  )
}
