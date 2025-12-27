import { getNetworkName } from '@jejunetwork/config'
import clsx from 'clsx'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Coins,
  LayoutDashboard,
  Menu,
  Server,
  Settings,
  Shield,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import type { ViewType } from '../../lib/types'
import { useAppStore } from '../context/AppContext'

const networkName = getNetworkName()

const navItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { id: 'services', label: 'Services', icon: <Server size={20} /> },
  { id: 'bots', label: 'Bots', icon: <Bot size={20} /> },
  { id: 'earnings', label: 'Earnings', icon: <TrendingUp size={20} /> },
  { id: 'staking', label: 'Staking', icon: <Coins size={20} /> },
  { id: 'wallet', label: 'Wallet', icon: <Wallet size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
]

export function Sidebar() {
  const { currentView, setCurrentView, services, hardware, wallet } =
    useAppStore()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)

  const runningServices = services.filter((s) => s.status.running).length
  const hasTee = hardware?.tee.attestation_available

  const handleNavClick = (id: ViewType) => {
    setCurrentView(id)
    setIsMobileOpen(false)
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="p-5 border-b border-volcanic-800/60">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-jeju-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-jeju-500/20 animate-glow-pulse">
            <Zap size={24} className="text-white" />
          </div>
          {!isCollapsed && (
            <h1 className="font-bold text-lg gradient-text">
              {networkName} Node
            </h1>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div
        className={clsx(
          'px-4 py-3 border-b border-volcanic-800/60',
          isCollapsed && 'flex justify-center',
        )}
      >
        {isCollapsed ? (
          <div
            className={clsx(
              'w-3 h-3 rounded-full',
              runningServices > 0
                ? 'bg-jeju-500 shadow-lg shadow-jeju-500/50 animate-pulse'
                : 'bg-volcanic-600',
            )}
          />
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-volcanic-400">Node Status</span>
              <div className="flex items-center gap-2">
                {runningServices > 0 ? (
                  <>
                    <span className="status-healthy" />
                    <span className="text-jeju-400 font-medium">
                      {runningServices} running
                    </span>
                  </>
                ) : (
                  <>
                    <span className="status-offline" />
                    <span className="text-volcanic-500">Standing by</span>
                  </>
                )}
              </div>
            </div>

            {hasTee && (
              <div className="flex items-center gap-2 mt-2 text-xs text-volcanic-400 bg-jeju-500/10 px-2 py-1 rounded-lg w-fit">
                <Shield size={12} className="text-jeju-500" />
                <span>Secure TEE Ready</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => handleNavClick(item.id)}
            aria-label={item.label}
            aria-current={currentView === item.id ? 'page' : undefined}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200',
              isCollapsed ? 'justify-center' : '',
              currentView === item.id
                ? 'bg-gradient-to-r from-jeju-600/20 to-emerald-600/10 text-jeju-400 border border-jeju-500/30 shadow-md shadow-jeju-500/5'
                : 'text-volcanic-400 hover:text-volcanic-100 hover:bg-volcanic-800/50',
            )}
          >
            <span
              className={clsx(
                currentView === item.id &&
                  'drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]',
              )}
            >
              {item.icon}
            </span>
            {!isCollapsed && <span className="font-medium">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Wallet Status */}
      <div className="p-4 border-t border-volcanic-800/60">
        {wallet ? (
          <button
            type="button"
            className={clsx(
              'card-hover p-3 w-full',
              isCollapsed ? 'flex justify-center' : 'text-left',
            )}
            onClick={() => handleNavClick('wallet')}
            aria-label="Open wallet"
          >
            <div
              className={clsx(
                'flex items-center gap-3',
                isCollapsed && 'justify-center',
              )}
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-jeju-500/20 to-emerald-500/20 flex items-center justify-center ring-2 ring-jeju-500/20">
                <Wallet size={16} className="text-jeju-400" />
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-volcanic-200">
                    {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                  </p>
                  <p className="text-xs text-jeju-400/70 capitalize">
                    Connected
                  </p>
                </div>
              )}
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleNavClick('wallet')}
            className={clsx(
              'btn-primary',
              isCollapsed
                ? 'w-11 h-11 p-0 flex items-center justify-center'
                : 'w-full',
            )}
            aria-label="Connect wallet"
          >
            {isCollapsed ? <Wallet size={18} /> : 'Connect Wallet'}
          </button>
        )}
      </div>

      {/* Collapse toggle - Desktop only */}
      <button
        type="button"
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 bg-volcanic-800 border border-volcanic-700 rounded-full items-center justify-center text-volcanic-400 hover:text-volcanic-100 hover:bg-volcanic-700 transition-colors"
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </>
  )

  return (
    <>
      {/* Mobile menu button */}
      <button
        type="button"
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-xl bg-volcanic-900/90 border border-volcanic-800 text-volcanic-300 hover:text-volcanic-100 hover:bg-volcanic-800"
        aria-label="Open menu"
      >
        <Menu size={24} />
      </button>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-40 bg-volcanic-950/80 backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
          aria-label="Close menu"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={clsx(
          'lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-volcanic-900/95 backdrop-blur-md border-r border-volcanic-800 flex flex-col transition-transform duration-300',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileOpen(false)}
          className="absolute top-4 right-4 p-2 rounded-lg text-volcanic-400 hover:text-volcanic-100 hover:bg-volcanic-800"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'hidden lg:flex relative bg-volcanic-900/50 border-r border-volcanic-800 flex-col transition-all duration-300',
          isCollapsed ? 'w-20' : 'w-64',
        )}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
