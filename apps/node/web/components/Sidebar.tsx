import { getNetworkName } from '@jejunetwork/config'
import clsx from 'clsx'
import {
  Bot,
  Coins,
  LayoutDashboard,
  Server,
  Settings,
  Shield,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react'
import type { ViewType } from '../../lib/types'
import { useAppStore } from '../context/AppContext'

const networkName = getNetworkName()

const navItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { id: 'services', label: 'Services', icon: <Server size={20} /> },
  { id: 'bots', label: 'Trading Bots', icon: <Bot size={20} /> },
  { id: 'earnings', label: 'Earnings', icon: <TrendingUp size={20} /> },
  { id: 'staking', label: 'Staking', icon: <Coins size={20} /> },
  { id: 'wallet', label: 'Wallet', icon: <Wallet size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
]

export function Sidebar() {
  const { currentView, setCurrentView, services, hardware, wallet } =
    useAppStore()

  const runningServices = services.filter((s) => s.status.running).length
  const hasTee = hardware?.tee.attestation_available

  return (
    <aside className="w-64 bg-volcanic-900/50 border-r border-volcanic-800 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-volcanic-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-jeju-500 to-jeju-700 flex items-center justify-center">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg gradient-text">
              {networkName} Node
            </h1>
            <p className="text-xs text-volcanic-500">v0.1.0</p>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="px-4 py-3 border-b border-volcanic-800">
        <div className="flex items-center justify-between text-sm">
          <span className="text-volcanic-400">Status</span>
          <div className="flex items-center gap-2">
            {runningServices > 0 ? (
              <>
                <span className="status-healthy animate-pulse" />
                <span className="text-jeju-400">{runningServices} active</span>
              </>
            ) : (
              <>
                <span className="status-offline" />
                <span className="text-volcanic-500">Idle</span>
              </>
            )}
          </div>
        </div>

        {hasTee && (
          <div className="flex items-center gap-2 mt-2 text-xs text-volcanic-400">
            <Shield size={14} className="text-jeju-500" />
            <span>TEE Available</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
              currentView === item.id
                ? 'bg-jeju-600/20 text-jeju-400 border border-jeju-500/30'
                : 'text-volcanic-400 hover:text-volcanic-200 hover:bg-volcanic-800/50',
            )}
          >
            {item.icon}
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Wallet Status */}
      <div className="p-4 border-t border-volcanic-800">
        {wallet ? (
          <button
            type="button"
            className="card-hover p-3 cursor-pointer w-full text-left"
            onClick={() => setCurrentView('wallet')}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-jeju-600/20 flex items-center justify-center">
                <Wallet size={16} className="text-jeju-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </p>
                <p className="text-xs text-volcanic-500 capitalize">
                  {wallet.wallet_type}
                </p>
              </div>
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCurrentView('wallet')}
            className="btn-primary w-full"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </aside>
  )
}
