import { WalletButton } from '@jejunetwork/ui'
import {
  BarChart3,
  Bell,
  Bot,
  Box,
  Brain,
  ChevronLeft,
  Cloud,
  Code2,
  Coins,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Download,
  FolderGit2,
  Gauge,
  GitBranch,
  Globe,
  Key,
  Keyboard,
  Layers,
  LayoutList,
  Lock,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  Network,
  Package,
  Radio,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Store,
  Sun,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { NETWORK } from '../config'
import { useTheme } from '../context/AppContext'

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
  {
    title: 'Provide & Earn',
    items: [
      {
        id: 'run-node',
        label: 'Run a Node',
        icon: <Download size={20} />,
        path: '/provider/node',
      },
      {
        id: 'my-nodes',
        label: 'My Nodes',
        icon: <Server size={20} />,
        path: '/provider/nodes',
      },
      {
        id: 'earnings',
        label: 'Earnings',
        icon: <DollarSign size={20} />,
        path: '/provider/earnings',
      },
      {
        id: 'broker-sdk',
        label: 'Broker SDK',
        icon: <Code2 size={20} />,
        path: '/provider/broker',
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

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Close sidebar when route changes (mobile)
  const prevPathRef = useRef(location.pathname)
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setSidebarOpen(false)
      prevPathRef.current = location.pathname
    }
  }, [location.pathname])

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + B to toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setCollapsed((c) => !c)
      }
      // Cmd/Ctrl + / to toggle shortcuts modal
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShowShortcuts((s) => !s)
      }
      // Escape to close shortcuts
      if (e.key === 'Escape') {
        setShowShortcuts(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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
          className="sidebar-overlay"
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
              className="btn btn-ghost btn-icon sidebar-collapse-btn"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar (⌘B)"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {collapsed && (
            <button
              type="button"
              className="btn btn-ghost btn-icon sidebar-expand-btn"
              onClick={() => setCollapsed(false)}
              title="Expand sidebar (⌘B)"
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

          {/* Faucet link for testnet/localnet */}
          {NETWORK !== 'mainnet' && (
            <div className="nav-section">
              <div className="nav-section-title">Testnet</div>
              <Link
                to="/faucet"
                className={`nav-item ${isActive('/faucet') ? 'active' : ''}`}
              >
                <Coins size={20} />
                <span>Faucet</span>
              </Link>
            </div>
          )}
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
              className="btn btn-ghost btn-icon mobile-menu-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            <nav className="breadcrumbs">
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.path}>
                  {i > 0 && <span className="breadcrumb-sep">/</span>}
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
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (⌘/)"
            >
              <Keyboard size={18} />
            </button>

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

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-title"
        >
          <button
            type="button"
            className="modal-backdrop"
            onClick={() => setShowShortcuts(false)}
            tabIndex={-1}
            aria-label="Close"
          />
          <div className="modal" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowShortcuts(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="shortcuts-list">
                <div className="shortcut-group">
                  <h3>Navigation</h3>
                  <ShortcutRow keys={['g', 'd']} action="Go to Dashboard" />
                  <ShortcutRow keys={['g', 's']} action="Go to Storage" />
                  <ShortcutRow keys={['g', 'c']} action="Go to Containers" />
                  <ShortcutRow keys={['g', 'w']} action="Go to Workers" />
                  <ShortcutRow keys={['g', 'b']} action="Go to Billing" />
                </div>
                <div className="shortcut-group">
                  <h3>Application</h3>
                  <ShortcutRow keys={['⌘', 'B']} action="Toggle sidebar" />
                  <ShortcutRow keys={['⌘', '/']} action="Show shortcuts" />
                  <ShortcutRow keys={['Esc']} action="Close dialogs" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ShortcutRow({ keys, action }: { keys: string[]; action: string }) {
  return (
    <div className="shortcut-row">
      <span className="shortcut-action">{action}</span>
      <div className="shortcut-keys">
        {keys.map((key, i) => (
          <span key={`${action}-${key}`}>
            <kbd>{key}</kbd>
            {i < keys.length - 1 && <span className="key-sep">+</span>}
          </span>
        ))}
      </div>
    </div>
  )
}
