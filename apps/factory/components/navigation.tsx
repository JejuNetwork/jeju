'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Home,
  DollarSign,
  Briefcase,
  GitBranch,
  Package,
  Box,
  Brain,
  LayoutDashboard,
  MessageSquare,
  Shield,
  Settings,
  HelpCircle,
  ChevronDown,
  Search,
  Bell,
  User,
  Sparkles,
  Bot,
  Users,
  Play,
  Database,
  Rocket,
} from 'lucide-react';
import { clsx } from 'clsx';

const navigation = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Feed', href: '/feed', icon: MessageSquare },
  { 
    name: 'Work', 
    icon: Briefcase,
    children: [
      { name: 'Bounties', href: '/bounties', icon: DollarSign },
      { name: 'Jobs', href: '/jobs', icon: Briefcase },
      { name: 'Projects', href: '/projects', icon: LayoutDashboard },
    ]
  },
  { 
    name: 'Code', 
    icon: GitBranch,
    children: [
      { name: 'Repositories', href: '/git', icon: GitBranch },
      { name: 'Packages', href: '/packages', icon: Package },
      { name: 'Containers', href: '/containers', icon: Box },
      { name: 'CI/CD', href: '/ci', icon: Play },
    ]
  },
  { 
    name: 'AI', 
    icon: Brain,
    children: [
      { name: 'Models', href: '/models', icon: Brain },
      { name: 'Datasets', href: '/datasets', icon: Database },
      { name: 'Training', href: '/training', icon: Sparkles },
    ]
  },
  { 
    name: 'Collaboration', 
    icon: Users,
    children: [
      { name: 'Agents', href: '/agents', icon: Bot },
      { name: 'Guardians', href: '/guardians', icon: Shield },
      { name: 'Teams', href: '/teams', icon: Users },
    ]
  },
];

const bottomNav = [
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'Help', href: '/help', icon: HelpCircle },
];

export function Navigation() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<string[]>(['Work', 'Code', 'AI']);

  const toggleExpanded = (name: string) => {
    setExpanded(prev => 
      prev.includes(name) 
        ? prev.filter(n => n !== name)
        : [...prev, name]
    );
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed left-0 top-0 bottom-0 w-64 bg-factory-950 border-r border-factory-800 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-factory-800">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-factory-100 font-display">Factory</h1>
            <p className="text-xs text-factory-500">Developer Hub</p>
          </div>
        </Link>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
          <input 
            type="text"
            placeholder="Search..."
            className="w-full pl-10 pr-4 py-2 bg-factory-900 border border-factory-800 rounded-lg text-sm text-factory-300 placeholder-factory-600 focus:outline-none focus:border-accent-500 transition-colors"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-factory-600 bg-factory-800 px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navigation.map((item) => (
            <li key={item.name}>
              {'children' in item ? (
                <div>
                  <button
                    onClick={() => toggleExpanded(item.name)}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      'text-factory-400 hover:text-factory-100 hover:bg-factory-800/50'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </span>
                    <ChevronDown className={clsx(
                      'w-4 h-4 transition-transform',
                      expanded.includes(item.name) && 'rotate-180'
                    )} />
                  </button>
                  {expanded.includes(item.name) && item.children && (
                    <ul className="mt-1 ml-4 space-y-1">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link
                            href={child.href}
                            className={clsx(
                              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                              isActive(child.href)
                                ? 'bg-accent-500/10 text-accent-400 font-medium'
                                : 'text-factory-400 hover:text-factory-100 hover:bg-factory-800/50'
                            )}
                          >
                            <child.icon className="w-4 h-4" />
                            {child.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <Link
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive(item.href)
                      ? 'bg-accent-500/10 text-accent-400'
                      : 'text-factory-400 hover:text-factory-100 hover:bg-factory-800/50'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.name}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom Navigation */}
      <div className="border-t border-factory-800 px-3 py-4">
        <ul className="space-y-1">
          {bottomNav.map((item) => (
            <li key={item.name}>
              <Link
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive(item.href)
                    ? 'bg-accent-500/10 text-accent-400'
                    : 'text-factory-400 hover:text-factory-100 hover:bg-factory-800/50'
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* User section */}
      <div className="border-t border-factory-800 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-factory-800 flex items-center justify-center">
            <User className="w-5 h-5 text-factory-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-factory-100 truncate">Connect Wallet</p>
            <p className="text-xs text-factory-500">to get started</p>
          </div>
          <button className="p-2 hover:bg-factory-800 rounded-lg transition-colors">
            <Bell className="w-5 h-5 text-factory-400" />
          </button>
        </div>
      </div>
    </nav>
  );
}

