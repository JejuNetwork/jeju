/**
 * Mobile Navigation Component
 * Responsive hamburger menu for mobile devices
 */

'use client'

import { clsx } from 'clsx'
import {
  Box,
  Brain,
  Briefcase,
  ChevronRight,
  Database,
  DollarSign,
  GitBranch,
  Home,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Package,
  Play,
  Settings,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const navSections = [
  {
    title: 'Main',
    items: [
      { name: 'Home', href: '/', icon: Home },
      { name: 'Feed', href: '/feed', icon: MessageSquare },
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
      { name: 'Datasets', href: '/datasets', icon: Database },
      { name: 'Training', href: '/training', icon: Sparkles },
    ],
  },
  {
    title: 'Network',
    items: [
      { name: 'Guardians', href: '/guardians', icon: Shield },
      { name: 'Agents', href: '/agents', icon: Users },
    ],
  },
]

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()

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

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-factory-900/95 backdrop-blur-sm border-b border-factory-800">
        <div className="flex items-center justify-between px-4 h-14">
          <Link href="/" className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-accent-500" />
            <span className="font-bold text-lg text-factory-100">Factory</span>
          </Link>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 -mr-2 text-factory-400 hover:text-factory-100"
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={clsx(
          'lg:hidden fixed inset-0 z-40 transition-opacity duration-300',
          isOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none',
        )}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />

        {/* Menu Panel */}
        <nav
          className={clsx(
            'absolute top-14 left-0 bottom-0 w-72 bg-factory-900 border-r border-factory-800 overflow-y-auto transition-transform duration-300',
            isOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="p-4 space-y-6">
            {navSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-factory-500 uppercase tracking-wider mb-2 px-3">
                  {section.title}
                </h3>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={clsx(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                          isActive(item.href)
                            ? 'bg-accent-500/10 text-accent-400'
                            : 'text-factory-300 hover:text-factory-100 hover:bg-factory-800/50',
                        )}
                      >
                        <item.icon className="w-5 h-5" />
                        {item.name}
                        <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Settings */}
            <div className="border-t border-factory-800 pt-4">
              <Link
                href="/settings"
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-factory-300 hover:text-factory-100 hover:bg-factory-800/50"
              >
                <Settings className="w-5 h-5" />
                Settings
              </Link>
            </div>
          </div>
        </nav>
      </div>

      {/* Spacer for fixed header */}
      <div className="lg:hidden h-14" />
    </>
  )
}
