import {
  Activity,
  Globe,
  HardDrive,
  Heart,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { invoke, isTauri } from '../lib'
import { ConnectionStats } from './components/ConnectionStats'
import { ContributionPanel } from './components/ContributionPanel'
import { RegionSelector } from './components/RegionSelector'
import { SettingsPanel } from './components/SettingsPanel'
import { VPNToggle } from './components/VPNToggle'
import {
  useContribution,
  useVPNConnection,
  useVPNNodes,
  useVPNStatus,
} from './hooks'

type Tab = 'vpn' | 'contribution' | 'settings'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('vpn')
  const { status: vpnStatus } = useVPNStatus()
  const { nodes, selectedNode, selectNode: handleSelectNode } = useVPNNodes()
  const { connect, disconnect, isLoading } = useVPNConnection()
  const { stats, dws } = useContribution()

  const isConnected = vpnStatus.status === 'Connected'
  const isConnecting = vpnStatus.status === 'Connecting'

  const handleConnect = useCallback(async () => {
    if (vpnStatus.status === 'Connected') {
      await disconnect()
    } else {
      await connect(selectedNode)
    }
  }, [vpnStatus.status, disconnect, connect, selectedNode])

  // Sync tray state with VPN status
  useEffect(() => {
    if (!isTauri()) return

    const location = selectedNode
      ? `${selectedNode.region}, ${selectedNode.country_code}`
      : undefined

    invoke('update_tray_state', {
      connected: isConnected,
      location,
      contributionPercent: 10,
    }).catch((err) => {
      console.warn('Failed to update tray state:', err)
    })
  }, [isConnected, selectedNode])

  // Listen for tray events
  useEffect(() => {
    if (!isTauri()) return

    let cleanup: (() => void) | undefined

    const setupListeners = async () => {
      const { listen } = await import('@tauri-apps/api/event')

      const unlistenToggle = await listen('tray_toggle_vpn', () => {
        handleConnect()
      })

      const unlistenNavigate = await listen<string>('navigate', (event) => {
        if (event.payload === 'settings') {
          setActiveTab('settings')
        } else if (event.payload === 'locations') {
          setActiveTab('vpn')
        }
      })

      const unlistenQuit = await listen('app_quit', async () => {
        if (isConnected) {
          await disconnect()
        }
      })

      cleanup = () => {
        unlistenToggle()
        unlistenNavigate()
        unlistenQuit()
      }
    }

    setupListeners()

    return () => cleanup?.()
  }, [handleConnect, isConnected, disconnect])

  const getStatusBadge = () => {
    if (isConnected) {
      return <span className="status-connected">Protected</span>
    }
    if (isConnecting) {
      return <span className="status-connecting">Connecting</span>
    }
    return <span className="status-disconnected">Ready</span>
  }

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-4 border-b border-border safe-area-top">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl transition-colors ${
              isConnected ? 'bg-accent/10 shadow-glow' : 'bg-surface-elevated'
            }`}
          >
            <Shield
              className={`w-6 h-6 transition-colors ${
                isConnected ? 'text-accent' : 'text-muted'
              }`}
            />
          </div>
          <h1 className="text-lg font-semibold">Jeju VPN</h1>
        </div>
        {getStatusBadge()}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'vpn' && (
          <div className="p-5 space-y-6">
            <VPNToggle
              isConnected={isConnected}
              isLoading={isLoading}
              onToggle={handleConnect}
            />

            <RegionSelector
              nodes={nodes}
              selectedNode={selectedNode}
              onSelectNode={handleSelectNode}
              disabled={isConnected}
            />

            {isConnected && vpnStatus.connection && (
              <ConnectionStats connection={vpnStatus.connection} />
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="card text-center hover:border-accent/20 transition-colors">
                <Globe className="w-5 h-5 mx-auto mb-2 text-accent" />
                <div className="text-lg font-bold">{nodes.length}</div>
                <div className="text-xs text-muted">Locations</div>
              </div>
              <div className="card text-center hover:border-accent/20 transition-colors">
                <Users className="w-5 h-5 mx-auto mb-2 text-accent-secondary" />
                <div className="text-lg font-bold">
                  {stats?.users_helped ?? 0}
                </div>
                <div className="text-xs text-muted">Helped</div>
              </div>
              <div className="card text-center hover:border-accent/20 transition-colors">
                <HardDrive className="w-5 h-5 mx-auto mb-2 text-accent-tertiary" />
                <div className="text-lg font-bold">
                  {dws ? `${dws.cache_used_mb}` : '0'}
                </div>
                <div className="text-xs text-muted">MB Cached</div>
              </div>
            </div>

            {/* Community message */}
            {!isConnected && (
              <div className="flex items-center gap-3 p-4 bg-accent/5 border border-accent/20 rounded-xl">
                <Heart className="w-5 h-5 text-accent flex-shrink-0" />
                <p className="text-sm text-muted-light">
                  Contribute bandwidth when idle to help others.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'contribution' && <ContributionPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>

      {/* Bottom Navigation */}
      <nav className="flex items-center justify-around border-t border-border py-2 safe-area-bottom bg-surface">
        <button
          type="button"
          onClick={() => setActiveTab('vpn')}
          aria-label="VPN tab"
          aria-current={activeTab === 'vpn' ? 'page' : undefined}
          className={`flex flex-col items-center gap-1 px-6 py-2.5 rounded-xl transition-all ${
            activeTab === 'vpn'
              ? 'text-accent bg-accent/5'
              : 'text-muted hover:text-white'
          }`}
        >
          <Shield className="w-5 h-5" />
          <span className="text-xs font-medium">VPN</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('contribution')}
          aria-label="Contribute tab"
          aria-current={activeTab === 'contribution' ? 'page' : undefined}
          className={`flex flex-col items-center gap-1 px-6 py-2.5 rounded-xl transition-all ${
            activeTab === 'contribution'
              ? 'text-accent bg-accent/5'
              : 'text-muted hover:text-white'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-xs font-medium">Give Back</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          aria-label="Settings tab"
          aria-current={activeTab === 'settings' ? 'page' : undefined}
          className={`flex flex-col items-center gap-1 px-6 py-2.5 rounded-xl transition-all ${
            activeTab === 'settings'
              ? 'text-accent bg-accent/5'
              : 'text-muted hover:text-white'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-xs font-medium">Settings</span>
        </button>
      </nav>
    </div>
  )
}

export default App
