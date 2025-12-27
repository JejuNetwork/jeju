import { WalletButton } from '@jejunetwork/ui'
import {
  BarChart3,
  Bell,
  Bot,
  Box,
  Brain,
  ChevronLeft,
  Cloud,
  Cpu,
  CreditCard,
  Database,
  FolderGit2,
  Gauge,
  GitBranch,
  Globe,
  Key,
  Layers,
  LayoutList,
  Lock,
  Mail,
  Menu,
  MessageSquare,
  Network,
  Package,
  Radio,
  Search,
  Settings,
  Shield,
  Sparkles,
  Store,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { ViewMode } from '../types'

interface LayoutProps {
  children: React.ReactNode
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  path: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Compute',
    items: [
      {
        id: 'containers',
        label: 'Containers',
        icon: <Box size={20} />,
        path: '/compute/containers',
      },
      {
        id: 'workers',
        label: 'Workers',
        icon: <Zap size={20} />,
        path: '/compute/workers',
      },
      {
        id: 'jobs',
        label: 'Jobs',
        icon: <Cpu size={20} />,
        path: '/compute/jobs',
      },
      {
        id: 'training',
        label: 'Training',
        icon: <Gauge size={20} />,
        path: '/compute/training',
      },
    ],
  },
  {
    title: 'Storage',
    items: [
      {
        id: 'buckets',
        label: 'Buckets',
        icon: <Database size={20} />,
        path: '/storage/buckets',
      },
      {
        id: 'cdn',
        label: 'CDN',
        icon: <Cloud size={20} />,
        path: '/storage/cdn',
      },
      {
        id: 'ipfs',
        label: 'IPFS',
        icon: <Globe size={20} />,
        path: '/storage/ipfs',
      },
    ],
  },
  {
    title: 'Developer',
    items: [
      {
        id: 'repos',
        label: 'Repositories',
        icon: <FolderGit2 size={20} />,
        path: '/developer/repositories',
      },
      {
        id: 'packages',
        label: 'Packages',
        icon: <Package size={20} />,
        path: '/developer/packages',
      },
      {
        id: 'pipelines',
        label: 'CI/CD',
        icon: <GitBranch size={20} />,
        path: '/developer/pipelines',
      },
    ],
  },
  {
    title: 'AI/ML',
    items: [
      {
        id: 'inference',
        label: 'Inference',
        icon: <Brain size={20} />,
        path: '/ai/inference',
      },
      {
        id: 'embeddings',
        label: 'Embeddings',
        icon: <MessageSquare size={20} />,
        path: '/ai/embeddings',
      },
      {
        id: 'mltraining',
        label: 'Training',
        icon: <Sparkles size={20} />,
        path: '/ai/training',
      },
    ],
  },
  {
    title: 'Security',
    items: [
      {
        id: 'keys',
        label: 'Keys (KMS)',
        icon: <Key size={20} />,
        path: '/security/keys',
      },
      {
        id: 'secrets',
        label: 'Secrets',
        icon: <Lock size={20} />,
        path: '/security/secrets',
      },
      {
        id: 'oauth3',
        label: 'OAuth3',
        icon: <Shield size={20} />,
        path: '/security/oauth3',
      },
    ],
  },
  {
    title: 'Network',
    items: [
      {
        id: 'rpc',
        label: 'RPC Gateway',
        icon: <Radio size={20} />,
        path: '/network/rpc',
      },
      {
        id: 'vpn',
        label: 'VPN/Proxy',
        icon: <Network size={20} />,
        path: '/network/vpn',
      },
      {
        id: 'da',
        label: 'Data Availability',
        icon: <Database size={20} />,
        path: '/network/da',
      },
    ],
  },
  {
    title: 'Agents',
    items: [
      {
        id: 'agents',
        label: 'A2A & MCP',
        icon: <Bot size={20} />,
        path: '/agents',
      },
    ],
  },
  {
    title: 'Services',
    items: [
      {
        id: 'email',
        label: 'Email',
        icon: <Mail size={20} />,
        path: '/services/email',
      },
      {
        id: 'scraping',
        label: 'Web Scraping',
        icon: <Search size={20} />,
        path: '/services/scraping',
      },
      {
        id: 'moderation',
        label: 'Moderation',
        icon: <Shield size={20} />,
        path: '/moderation',
      },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      {
        id: 'browse',
        label: 'Browse APIs',
        icon: <Store size={20} />,
        path: '/marketplace/browse',
      },
      {
        id: 'listings',
        label: 'My Listings',
        icon: <LayoutList size={20} />,
        path: '/marketplace/listings',
      },
    ],
  },
]

const BOTTOM_NAV: NavItem[] = [
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <BarChart3 size={20} />,
    path: '/analytics',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: <CreditCard size={20} />,
    path: '/billing',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings size={20} />,
    path: '/settings',
  },
]

export default function Layout({
  children,
  viewMode,
  setViewMode,
}: LayoutProps) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // Close sidebar when route changes (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [])

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isActive = (path: string) => location.pathname === path

  const getBreadcrumbs = () => {
    const parts = location.pathname.split('/').filter(Boolean)
    if (parts.length === 0) return [{ label: 'Dashboard', path: '/' }]

    const breadcrumbs = [{ label: 'Dashboard', path: '/' }]
    let currentPath = ''

    for (const part of parts) {
      currentPath += `/${part}`
      const label = part.charAt(0).toUpperCase() + part.slice(1)
      breadcrumbs.push({ label, path: currentPath })
    }

    return breadcrumbs
  }

  const breadcrumbs = getBreadcrumbs()

  return (
    <div className="layout">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden cursor-default"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''} ${sidebarOpen ? 'open' : ''}`}
      >
        <div className="sidebar-header">
          <Link to="/" className="logo">
            <div className="logo-icon">
              <Layers size={20} />
            </div>
            {!collapsed && <span>DWS</span>}
          </Link>
          {!collapsed && (
            <button
              type="button"
              className="btn btn-ghost btn-icon ml-auto hidden lg:flex"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {collapsed && (
            <button
              type="button"
              className="btn btn-ghost btn-icon hidden lg:flex"
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              style={{
                position: 'absolute',
                right: '-12px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              <ChevronLeft size={18} style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <Link
              to="/"
              className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}
            >
              <Gauge size={20} />
              <span>Dashboard</span>
            </Link>
          </div>

          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => (
                <Link
                  key={item.id}
                  to={item.path}
                  className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {BOTTOM_NAV.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              className={`nav-item ${isActive(item.path) ? 'active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </aside>

      <div className="main-content">
        <header className="header">
          <div className="header-left">
            <button
              type="button"
              className="btn btn-ghost btn-icon lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <nav className="breadcrumbs hidden md:flex">
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.path}>
                  {i > 0 && <span style={{ margin: '0 0.5rem' }}>/</span>}
                  {i === breadcrumbs.length - 1 ? (
                    <span className="current">{crumb.label}</span>
                  ) : (
                    <Link to={crumb.path}>{crumb.label}</Link>
                  )}
                </span>
              ))}
            </nav>
          </div>

          <div className="header-right">
            <div className="mode-toggle">
              <button
                type="button"
                className={viewMode === 'consumer' ? 'active' : ''}
                onClick={() => setViewMode('consumer')}
              >
                Consumer
              </button>
              <button
                type="button"
                className={viewMode === 'provider' ? 'active' : ''}
                onClick={() => setViewMode('provider')}
              >
                Provider
              </button>
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-icon"
              title="Notifications"
            >
              <Bell size={18} />
            </button>

            <WalletButton />
          </div>
        </header>

        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
