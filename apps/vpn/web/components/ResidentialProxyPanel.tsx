import {
  Activity,
  AlertCircle,
  Coins,
  Globe,
  Loader2,
  Radio,
  Server,
  Settings,
  Share2,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  Wifi,
} from 'lucide-react'
import { useState } from 'react'
import type { ResidentialProxyNodeType } from '../../lib/schemas'
import { formatBytes } from '../../lib/utils'
import { useResidentialProxy } from '../hooks'

export function ResidentialProxyPanel() {
  const {
    status,
    settings,
    isLoading,
    error: hookError,
    updateSettings,
    toggleEnabled,
    register,
    claimRewards,
  } = useResidentialProxy()

  const [showSettings, setShowSettings] = useState(false)
  const [stakeInput, setStakeInput] = useState('0.01')
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 text-[#606070] animate-spin" />
      </div>
    )
  }

  const handleRegister = async () => {
    setActionError(null)
    setActionLoading(true)
    try {
      await register(stakeInput)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to register node'
      setActionError(message)
      console.error('[ResidentialProxy] Register failed:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleClaimRewards = async () => {
    setActionError(null)
    setActionLoading(true)
    try {
      await claimRewards()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to claim rewards'
      setActionError(message)
      console.error('[ResidentialProxy] Claim failed:', err)
    } finally {
      setActionLoading(false)
    }
  }

  const handleNodeTypeChange = async (nodeType: ResidentialProxyNodeType) => {
    if (!settings) return
    setActionError(null)
    try {
      await updateSettings({ ...settings, node_type: nodeType })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update settings'
      setActionError(message)
      console.error('[ResidentialProxy] Settings update failed:', err)
    }
  }

  const handleToggleEnabled = async () => {
    setActionError(null)
    try {
      await toggleEnabled()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle'
      setActionError(message)
      console.error('[ResidentialProxy] Toggle failed:', err)
    }
  }

  const formatJeju = (weiStr: string) => {
    const wei = BigInt(weiStr)
    return (Number(wei) / 1e18).toFixed(4)
  }

  const uptimePercent = (status?.uptime_score ?? 0) / 100
  const successPercent = (status?.success_rate ?? 0) / 100

  const displayError = actionError ?? hookError?.message

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Share2 className="w-5 h-5 text-[#00ff88]" />
          Bandwidth Sharing
        </h2>
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-[#1a1a25] rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5 text-[#606070]" />
        </button>
      </div>

      {/* Error Display */}
      {displayError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-400">{displayError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-auto text-red-500 hover:text-red-400"
          >
            ×
          </button>
        </div>
      )}

      {/* Registration Card */}
      {!status?.is_registered && (
        <div className="card bg-gradient-to-br from-[#00ff88]/5 to-transparent border-[#00ff88]/20">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="w-6 h-6 text-[#00ff88]" />
            <div>
              <h3 className="font-medium">Join the Network</h3>
              <p className="text-xs text-[#606070]">
                Share your bandwidth and earn JEJU tokens
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="stake-input"
                className="text-sm text-[#606070] mb-1 block"
              >
                Stake Amount (ETH)
              </label>
              <input
                id="stake-input"
                type="number"
                step="0.001"
                min="0.01"
                value={stakeInput}
                onChange={(e) => setStakeInput(e.target.value)}
                className="w-full bg-[#1a1a25] border border-[#2a2a35] rounded-lg px-3 py-2 text-white"
              />
            </div>

            <button
              type="button"
              onClick={handleRegister}
              disabled={actionLoading}
              className="w-full py-3 bg-[#00ff88] hover:bg-[#00cc6a] disabled:bg-[#00ff88]/50 text-black font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {actionLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Registering...
                </>
              ) : (
                'Register as Node'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Status Card */}
      {status?.is_registered && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Radio
                className={`w-5 h-5 ${status.is_active ? 'text-[#00ff88]' : 'text-[#606070]'}`}
              />
              <span className="font-medium">Node Status</span>
            </div>
            <button
              type="button"
              onClick={handleToggleEnabled}
              className="flex items-center gap-2"
              disabled={actionLoading}
            >
              {settings?.enabled ? (
                <ToggleRight className="w-8 h-8 text-[#00ff88]" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-[#606070]" />
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-[#606070]">Status</span>
              <span
                className={
                  status.is_active ? 'text-[#00ff88]' : 'text-[#606070]'
                }
              >
                {status.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#606070]">Connections</span>
              <span>{status.current_connections}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#606070]">Coordinator</span>
              <span
                className={
                  status.coordinator_connected
                    ? 'text-[#00ff88]'
                    : 'text-red-500'
                }
              >
                {status.coordinator_connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#606070]">Sessions</span>
              <span>{status.total_sessions}</span>
            </div>
          </div>
        </div>
      )}

      {/* Performance Metrics */}
      {status?.is_registered && (
        <div className="card">
          <h3 className="font-medium flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-[#00cc6a]" />
            Performance
          </h3>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[#606070]">Uptime</span>
                <span>{uptimePercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-[#1a1a25] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#00ff88] rounded-full transition-all"
                  style={{ width: `${uptimePercent}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[#606070]">Success Rate</span>
                <span>{successPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-[#1a1a25] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#00cc6a] rounded-full transition-all"
                  style={{ width: `${successPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Earnings */}
      {status?.is_registered && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card">
            <Coins className="w-5 h-5 text-[#00ff88] mb-2" />
            <div className="text-lg font-semibold">
              {formatJeju(status.total_earnings)} JEJU
            </div>
            <div className="text-xs text-[#606070]">Total Earned</div>
          </div>
          <div className="card">
            <TrendingUp className="w-5 h-5 text-[#00cc6a] mb-2" />
            <div className="text-lg font-semibold">
              {formatJeju(status.pending_rewards)} JEJU
            </div>
            <div className="text-xs text-[#606070]">Pending</div>
          </div>
          <div className="card">
            <Wifi className="w-5 h-5 text-[#00aa55] mb-2" />
            <div className="text-lg font-semibold">
              {formatBytes(Number(BigInt(status.total_bytes_shared)))}
            </div>
            <div className="text-xs text-[#606070]">Bandwidth Shared</div>
          </div>
          <div className="card">
            <Server className="w-5 h-5 text-[#008844] mb-2" />
            <div className="text-lg font-semibold">{status.total_sessions}</div>
            <div className="text-xs text-[#606070]">Sessions</div>
          </div>
        </div>
      )}

      {/* Claim Rewards */}
      {status?.is_registered && BigInt(status.pending_rewards) > 0n && (
        <button
          type="button"
          onClick={handleClaimRewards}
          disabled={actionLoading}
          className="w-full py-3 bg-[#00ff88] hover:bg-[#00cc6a] disabled:bg-[#00ff88]/50 text-black font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {actionLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Claiming...
            </>
          ) : (
            `Claim ${formatJeju(status.pending_rewards)} JEJU`
          )}
        </button>
      )}

      {/* Settings */}
      {showSettings && settings && (
        <div className="card space-y-4">
          <h3 className="font-medium">Settings</h3>

          <div>
            <span className="text-sm text-[#606070] mb-2 block">Node Type</span>
            <div className="grid grid-cols-3 gap-2">
              {(['residential', 'datacenter', 'mobile'] as const).map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleNodeTypeChange(type)}
                    className={`p-2 rounded-lg text-sm capitalize ${
                      settings.node_type === type
                        ? 'bg-[#00ff88]/20 border border-[#00ff88]/40 text-[#00ff88]'
                        : 'bg-[#1a1a25] border border-[#2a2a35]'
                    }`}
                  >
                    {type}
                  </button>
                ),
              )}
            </div>
            <p className="text-xs text-[#606070] mt-1">
              {settings.node_type === 'residential' &&
                'Higher rewards for home connections'}
              {settings.node_type === 'datacenter' &&
                'Standard rewards for servers'}
              {settings.node_type === 'mobile' &&
                'Highest rewards for mobile data'}
            </p>
          </div>

          <div>
            <label
              htmlFor="max-bandwidth-input"
              className="text-sm text-[#606070] mb-2 block"
            >
              Max Bandwidth ({settings.max_bandwidth_mbps} Mbps)
            </label>
            <input
              id="max-bandwidth-input"
              type="range"
              min="10"
              max="1000"
              value={settings.max_bandwidth_mbps}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  max_bandwidth_mbps: Number(e.target.value),
                })
              }
              className="w-full"
            />
          </div>

          <div>
            <label
              htmlFor="max-connections-input"
              className="text-sm text-[#606070] mb-2 block"
            >
              Max Connections ({settings.max_concurrent_connections})
            </label>
            <input
              id="max-connections-input"
              type="range"
              min="1"
              max="100"
              value={settings.max_concurrent_connections}
              onChange={(e) =>
                updateSettings({
                  ...settings,
                  max_concurrent_connections: Number(e.target.value),
                })
              }
              className="w-full"
            />
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-[#00ff88]/5 border border-[#00ff88]/20 rounded-2xl p-4">
        <div className="flex gap-3">
          <Activity className="w-5 h-5 text-[#00ff88] flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="text-[#00ff88] font-medium mb-1">
              How Bandwidth Sharing Works
            </p>
            <p className="text-[#a0a0b0]">
              Share your unused bandwidth to power the decentralized proxy
              network. Earn JEJU tokens based on the bandwidth you contribute.
              Residential IPs earn 1.5x rewards, mobile IPs earn 2x.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
