import {
  Activity,
  Globe,
  HardDrive,
  Settings,
  Shield,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { invoke, isTauri } from '../lib'
import { formatBytes } from '../lib/utils'
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

      // Listen for tray toggle VPN event
      const unlistenToggle = await listen('tray_toggle_vpn', () => {
        handleConnect()
      })

      // Listen for navigation events from tray
      const unlistenNavigate = await listen<string>('navigate', (event) => {
        if (event.payload === 'settings') {
          setActiveTab('settings')
        } else if (event.payload === 'locations') {
          setActiveTab('vpn')
        }
      })

      // Listen for app quit event
      const unlistenQuit = await listen('app_quit', async () => {
        // Disconnect VPN before quitting
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

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a35]">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-xl ${isConnected ? 'bg-[#00ff88]/10' : 'bg-[#2a2a35]'}`}
          >
            <Shield
              className={`w-6 h-6 ${isConnected ? 'text-[#00ff88]' : 'text-[#606070]'}`}
            />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Jeju VPN</h1>
            <p className="text-xs text-[#606070]">Decentralized Privacy</p>
          </div>
        </div>
        <div
          className={`px-3 py-1 rounded-full text-xs font-medium ${
            isConnected
              ? 'bg-[#00ff88]/10 text-[#00ff88]'
              : vpnStatus.status === 'Connecting'
                ? 'bg-yellow-500/10 text-yellow-500'
                : 'bg-[#2a2a35] text-[#606070]'
          }`}
        >
          {vpnStatus.status}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        {activeTab === 'vpn' && (
          <div className="p-6 space-y-6">
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

            <div className="grid grid-cols-3 gap-3">
              <div className="card text-center">
                <Globe className="w-5 h-5 mx-auto mb-2 text-[#00ff88]" />
                <div className="text-lg font-semibold">{nodes.length}</div>
                <div className="text-xs text-[#606070]">Nodes</div>
              </div>
              <div className="card text-center">
                <Users className="w-5 h-5 mx-auto mb-2 text-[#00cc6a]" />
                <div className="text-lg font-semibold">
                  {stats?.users_helped ?? 0}
                </div>
                <div className="text-xs text-[#606070]">Users Helped</div>
              </div>
              <div className="card text-center">
                <HardDrive className="w-5 h-5 mx-auto mb-2 text-[#00aa55]" />
                <div className="text-lg font-semibold">
                  {dws ? `${dws.cache_used_mb} MB` : formatBytes(0)}
                </div>
                <div className="text-xs text-[#606070]">CDN Cache</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'contribution' && <ContributionPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>

      <nav className="flex items-center justify-around border-t border-[#2a2a35] py-3">
        <button
          type="button"
          onClick={() => setActiveTab('vpn')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-colors ${
            activeTab === 'vpn'
              ? 'text-[#00ff88]'
              : 'text-[#606070] hover:text-white'
          }`}
        >
          <Shield className="w-5 h-5" />
          <span className="text-xs">VPN</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('contribution')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-colors ${
            activeTab === 'contribution'
              ? 'text-[#00ff88]'
              : 'text-[#606070] hover:text-white'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-xs">Contribute</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-colors ${
            activeTab === 'settings'
              ? 'text-[#00ff88]'
              : 'text-[#606070] hover:text-white'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-xs">Settings</span>
        </button>
      </nav>
    </div>
  )
}

export default App
