import {
  ChevronRight,
  ExternalLink,
  Gauge,
  Globe,
  Heart,
  Info,
  Power,
  Shield,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { invoke } from '../../lib'

const BooleanResponseSchema = z.boolean()

const VPNConfigSchema = z.object({
  rpc_url: z.string(),
  chain_id: z.number(),
  vpn_registry: z.string(),
  coordinator_url: z.string(),
  dns_servers: z.array(z.string()),
  kill_switch: z.boolean(),
  auto_connect: z.boolean(),
  auto_start: z.boolean(),
  minimize_to_tray: z.boolean(),
  show_notifications: z.boolean(),
  adaptive_bandwidth: z.boolean(),
  contribution: z.object({
    enabled: z.boolean(),
    max_bandwidth_percent: z.number(),
    share_cdn: z.boolean(),
    share_vpn_relay: z.boolean(),
    earning_mode: z.boolean(),
    earning_bandwidth_percent: z.number(),
    schedule_enabled: z.boolean(),
    schedule_start: z.string(),
    schedule_end: z.string(),
  }),
})

type VPNConfig = z.infer<typeof VPNConfigSchema>

interface ToggleSwitchProps {
  enabled: boolean
  onToggle: () => void
  label: string
}

function ToggleSwitch({ enabled, onToggle, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={enabled}
      className={`toggle-switch ${enabled ? 'bg-accent' : 'bg-border'}`}
    >
      <div
        className={`toggle-thumb ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

interface SettingRowProps {
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
}

function SettingRow({ title, description, enabled, onToggle }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex-1 min-w-0 pr-4">
        <div className="font-medium text-white">{title}</div>
        <div className="text-xs text-muted mt-0.5">{description}</div>
      </div>
      <ToggleSwitch enabled={enabled} onToggle={onToggle} label={title} />
    </div>
  )
}

export function SettingsPanel() {
  const [config, setConfig] = useState<VPNConfig | null>(null)
  const [dwsEnabled, setDwsEnabled] = useState(true)

  useEffect(() => {
    invoke('get_settings', {}, VPNConfigSchema).then(setConfig)
  }, [])

  const updateConfig = useCallback(
    async (updates: Partial<VPNConfig>) => {
      if (!config) return
      const newConfig = { ...config, ...updates }
      setConfig(newConfig)
      await invoke('update_settings', { settings: newConfig })
    },
    [config],
  )

  const toggleAdaptive = async () => {
    await updateConfig({ adaptive_bandwidth: !config?.adaptive_bandwidth })
    await invoke('set_adaptive_mode', {
      enabled: !config?.adaptive_bandwidth,
    })
  }

  const toggleDws = async () => {
    const newValue = !dwsEnabled
    setDwsEnabled(newValue)
    await invoke('set_dws_enabled', { enabled: newValue })
  }

  if (!config) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[200px]">
        <div className="text-muted animate-pulse">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5 pb-safe">
      <h2 className="text-xl font-semibold">Settings</h2>

      {/* Connection Settings */}
      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" />
          Connection
        </h3>

        <div className="space-y-4">
          <SettingRow
            title="Kill Switch"
            description="Block internet if VPN disconnects"
            enabled={config.kill_switch}
            onToggle={() => updateConfig({ kill_switch: !config.kill_switch })}
          />
          <SettingRow
            title="Auto Connect"
            description="Connect when app launches"
            enabled={config.auto_connect}
            onToggle={() => updateConfig({ auto_connect: !config.auto_connect })}
          />
        </div>
      </div>

      {/* Startup Settings */}
      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Power className="w-4 h-4 text-accent-secondary" />
          Startup
        </h3>

        <div className="space-y-4">
          <SettingRow
            title="Start on Boot"
            description="Launch VPN when your system starts"
            enabled={config.auto_start}
            onToggle={async () => {
              const newValue = !config.auto_start
              await updateConfig({ auto_start: newValue })
              await invoke('toggle_autostart', {}, BooleanResponseSchema)
            }}
          />
          <SettingRow
            title="Minimize to Tray"
            description="Keep running quietly in system tray"
            enabled={config.minimize_to_tray}
            onToggle={() => updateConfig({ minimize_to_tray: !config.minimize_to_tray })}
          />
        </div>
      </div>

      {/* Protocol Settings */}
      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent-secondary" />
          Protocol
        </h3>

        <div className="space-y-2">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-accent/10 border border-accent/30 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-accent rounded-full" />
              <span className="font-medium">WireGuard</span>
            </div>
            <span className="text-xs text-accent font-medium">Recommended</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-surface-elevated rounded-xl opacity-50 cursor-not-allowed"
            disabled
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-muted rounded-full" />
              <span>SOCKS5 Proxy</span>
            </div>
            <span className="text-xs text-muted">Coming soon</span>
          </button>
        </div>
      </div>

      {/* Bandwidth Settings */}
      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent-tertiary" />
          Bandwidth
        </h3>

        <div className="space-y-4">
          <SettingRow
            title="Adaptive Bandwidth"
            description="Share more when idle (up to 80%)"
            enabled={config.adaptive_bandwidth}
            onToggle={toggleAdaptive}
          />
          <SettingRow
            title="Edge CDN Caching"
            description="Help serve content faster"
            enabled={dwsEnabled}
            onToggle={toggleDws}
          />
        </div>
      </div>

      {/* DNS Settings */}
      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted" />
          DNS Servers
        </h3>

        <div className="space-y-2">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-accent/10 border border-accent/30 rounded-xl"
          >
            <span className="font-medium">Cloudflare (1.1.1.1)</span>
            <div className="w-2 h-2 bg-accent rounded-full" />
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-surface-elevated rounded-xl hover:bg-surface-hover transition-colors"
          >
            <span>Google (8.8.8.8)</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-surface-elevated rounded-xl hover:bg-surface-hover transition-colors"
          >
            <span>Custom DNS</span>
            <ChevronRight className="w-4 h-4 text-muted" />
          </button>
        </div>
      </div>

      {/* About Section */}
      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Info className="w-4 h-4 text-muted" />
          About
        </h3>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Version</span>
            <span className="font-medium">0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Network</span>
            <span className="font-medium">Jeju Mainnet</span>
          </div>
          <a
            href="https://jejunetwork.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between text-accent hover:underline"
          >
            <span>Learn more about Jeju</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Community Message */}
      <div className="flex items-center gap-3 p-4 bg-accent/5 border border-accent/20 rounded-xl">
        <Heart className="w-5 h-5 text-accent flex-shrink-0" />
        <p className="text-sm text-muted-light">
          <span className="text-white font-medium">You're helping the network.</span>{' '}
          Thanks for using Jeju VPN.
        </p>
      </div>
    </div>
  )
}
