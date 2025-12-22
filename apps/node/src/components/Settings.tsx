import clsx from 'clsx'
import {
  Clock,
  Download,
  Globe,
  RotateCcw,
  Server,
  Settings as SettingsIcon,
  Shield,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '../store'

export function Settings() {
  const { config, updateConfig, setNetwork, hardware } = useAppStore()
  const [error, setError] = useState<string | null>(null)

  const [localConfig, setLocalConfig] = useState({
    start_minimized: config?.start_minimized ?? false,
    start_on_boot: config?.start_on_boot ?? false,
    notifications_enabled: config?.notifications_enabled ?? true,
    auto_claim: config?.earnings.auto_claim ?? true,
    auto_claim_threshold: (
      parseFloat(config?.earnings.auto_claim_threshold_wei ?? '0') / 1e18
    ).toString(),
    auto_claim_interval: config?.earnings.auto_claim_interval_hours ?? 24,
  })

  const handleSave = async () => {
    if (!config) return
    setError(null)

    // Validate inputs
    if (localConfig.auto_claim) {
      if (!/^\d+(\.\d+)?$/.test(localConfig.auto_claim_threshold)) {
        setError('Invalid claim threshold')
        return
      }
      const threshold = parseFloat(localConfig.auto_claim_threshold)
      if (threshold < 0) {
        setError('Claim threshold cannot be negative')
        return
      }

      if (
        localConfig.auto_claim_interval < 1 ||
        localConfig.auto_claim_interval > 168
      ) {
        setError('Check interval must be between 1 and 168 hours')
        return
      }
    }

    try {
      await updateConfig({
        start_minimized: localConfig.start_minimized,
        start_on_boot: localConfig.start_on_boot,
        notifications_enabled: localConfig.notifications_enabled,
        earnings: {
          auto_claim: localConfig.auto_claim,
          auto_claim_threshold_wei: (
            parseFloat(localConfig.auto_claim_threshold) * 1e18
          ).toString(),
          auto_claim_interval_hours: localConfig.auto_claim_interval,
          auto_compound: config.earnings.auto_compound,
          auto_stake_earnings: config.earnings.auto_stake_earnings,
        },
      })
    } catch (e) {
      setError(String(e))
    }
  }

  const networks = [
    { id: 'mainnet', name: 'Mainnet', chainId: 420690, color: 'bg-jeju-500' },
    { id: 'testnet', name: 'Testnet', chainId: 420691, color: 'bg-blue-500' },
    { id: 'localnet', name: 'Localnet', chainId: 1337, color: 'bg-yellow-500' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-volcanic-400 mt-1">
          Configure your Network Node preferences
        </p>
      </div>

      {/* Network Selection */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Globe size={18} className="text-volcanic-400" />
          Network
        </h2>

        <div className="grid grid-cols-3 gap-4">
          {networks.map((network) => (
            <button
              type="button"
              key={network.id}
              onClick={() => setNetwork(network.id)}
              className={clsx(
                'p-4 rounded-xl border-2 transition-all text-left',
                config?.network.network === network.id
                  ? 'border-jeju-500 bg-jeju-500/10'
                  : 'border-volcanic-700 hover:border-volcanic-600',
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className={clsx('w-2 h-2 rounded-full', network.color)} />
                <span className="font-medium">{network.name}</span>
              </div>
              <p className="text-xs text-volcanic-500">
                Chain ID: {network.chainId}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-4 p-3 bg-volcanic-800/50 rounded-lg">
          <p className="text-sm text-volcanic-400">
            Current RPC:{' '}
            <code className="text-volcanic-300">{config?.network.rpc_url}</code>
          </p>
        </div>
      </div>

      {/* System Info */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Server size={18} className="text-volcanic-400" />
          System Information
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-volcanic-400">OS</p>
            <p className="font-medium">
              {hardware?.os} {hardware?.os_version}
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">CPU</p>
            <p className="font-medium">{hardware?.cpu.cores_physical} cores</p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">Memory</p>
            <p className="font-medium">
              {((hardware?.memory.total_mb || 0) / 1024).toFixed(0)} GB
            </p>
          </div>
          <div>
            <p className="text-sm text-volcanic-400">TEE</p>
            <p className="font-medium flex items-center gap-2">
              {hardware?.tee.attestation_available ? (
                <>
                  <Shield size={14} className="text-jeju-400" />
                  {hardware.tee.has_intel_tdx
                    ? 'Intel TDX'
                    : hardware.tee.has_intel_sgx
                      ? 'Intel SGX'
                      : hardware.tee.has_amd_sev
                        ? 'AMD SEV'
                        : 'Available'}
                </>
              ) : (
                'Not Available'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Auto-Claim Settings */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock size={18} className="text-volcanic-400" />
          Auto-Claim Rewards
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable Auto-Claim</p>
              <p className="text-sm text-volcanic-500">
                Automatically claim rewards when threshold is met
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setLocalConfig({
                  ...localConfig,
                  auto_claim: !localConfig.auto_claim,
                })
              }
              className={clsx(
                'relative w-12 h-6 rounded-full transition-colors',
                localConfig.auto_claim ? 'bg-jeju-600' : 'bg-volcanic-700',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  localConfig.auto_claim ? 'left-7' : 'left-1',
                )}
              />
            </button>
          </div>

          {localConfig.auto_claim && (
            <>
              <div>
                <label htmlFor="claim-threshold" className="label">
                  Claim Threshold (ETH)
                </label>
                <input
                  id="claim-threshold"
                  type="number"
                  value={localConfig.auto_claim_threshold}
                  onChange={(e) => {
                    setLocalConfig({
                      ...localConfig,
                      auto_claim_threshold: e.target.value,
                    })
                    setError(null)
                  }}
                  className={clsx(
                    'input',
                    error?.includes('threshold') &&
                      'border-red-500 focus:border-red-500',
                  )}
                  step="0.1"
                  min="0"
                />
                <p className="text-xs text-volcanic-500 mt-1">
                  Claim when pending rewards exceed this amount
                </p>
              </div>

              <div>
                <label htmlFor="check-interval" className="label">
                  Check Interval (hours)
                </label>
                <input
                  id="check-interval"
                  type="number"
                  value={localConfig.auto_claim_interval}
                  onChange={(e) => {
                    setLocalConfig({
                      ...localConfig,
                      auto_claim_interval: parseInt(e.target.value, 10),
                    })
                    setError(null)
                  }}
                  className={clsx(
                    'input',
                    error?.includes('interval') &&
                      'border-red-500 focus:border-red-500',
                  )}
                  min="1"
                  max="168"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Application Settings */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <SettingsIcon size={18} className="text-volcanic-400" />
          Application
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Start Minimized</p>
              <p className="text-sm text-volcanic-500">
                Start the app minimized to system tray
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setLocalConfig({
                  ...localConfig,
                  start_minimized: !localConfig.start_minimized,
                })
              }
              className={clsx(
                'relative w-12 h-6 rounded-full transition-colors',
                localConfig.start_minimized ? 'bg-jeju-600' : 'bg-volcanic-700',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  localConfig.start_minimized ? 'left-7' : 'left-1',
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Start on Boot</p>
              <p className="text-sm text-volcanic-500">
                Automatically start when your computer boots
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setLocalConfig({
                  ...localConfig,
                  start_on_boot: !localConfig.start_on_boot,
                })
              }
              className={clsx(
                'relative w-12 h-6 rounded-full transition-colors',
                localConfig.start_on_boot ? 'bg-jeju-600' : 'bg-volcanic-700',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  localConfig.start_on_boot ? 'left-7' : 'left-1',
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Notifications</p>
              <p className="text-sm text-volcanic-500">
                Show desktop notifications for important events
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setLocalConfig({
                  ...localConfig,
                  notifications_enabled: !localConfig.notifications_enabled,
                })
              }
              className={clsx(
                'relative w-12 h-6 rounded-full transition-colors',
                localConfig.notifications_enabled
                  ? 'bg-jeju-600'
                  : 'bg-volcanic-700',
              )}
            >
              <span
                className={clsx(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  localConfig.notifications_enabled ? 'left-7' : 'left-1',
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Download size={18} className="text-volcanic-400" />
          Data Management
        </h2>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
          >
            <Download size={16} />
            Export Config
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
          >
            <Upload size={16} />
            Import Config
          </button>
          <button
            type="button"
            className="btn-ghost flex items-center gap-2 text-red-400 hover:text-red-300"
          >
            <RotateCcw size={16} />
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex flex-col items-end gap-2">
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="button" onClick={handleSave} className="btn-primary px-8">
          Save Settings
        </button>
      </div>
    </div>
  )
}
