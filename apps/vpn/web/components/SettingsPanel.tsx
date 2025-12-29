import {
  ExternalLink,
  Gauge,
  Globe,
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

function SettingRow({
  title,
  description,
  enabled,
  onToggle,
}: SettingRowProps) {
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

type DNSProvider = 'cloudflare' | 'google'

const DNS_SERVERS: Record<DNSProvider, string[]> = {
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  google: ['8.8.8.8', '8.8.4.4'],
}

export function SettingsPanel() {
  const [config, setConfig] = useState<VPNConfig | null>(null)
  const [dwsEnabled, setDwsEnabled] = useState(true)
  const [selectedDNS, setSelectedDNS] = useState<DNSProvider>('cloudflare')

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
            onToggle={() =>
              updateConfig({ auto_connect: !config.auto_connect })
            }
          />
        </div>
      </div>

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
            onToggle={() =>
              updateConfig({ minimize_to_tray: !config.minimize_to_tray })
            }
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent-secondary" />
          Protocol
        </h3>

        <div className="flex items-center justify-between p-3 bg-accent/10 border border-accent/30 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-accent rounded-full" />
            <span className="font-medium">WireGuard</span>
          </div>
        </div>
      </div>

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

      <div className="card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted" />
          DNS
        </h3>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              setSelectedDNS('cloudflare')
              updateConfig({ dns_servers: DNS_SERVERS.cloudflare })
            }}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
              selectedDNS === 'cloudflare'
                ? 'bg-accent/10 border border-accent/30'
                : 'bg-surface-elevated hover:bg-surface-hover'
            }`}
          >
            <span className={selectedDNS === 'cloudflare' ? 'font-medium' : ''}>
              Cloudflare (1.1.1.1)
            </span>
            {selectedDNS === 'cloudflare' && (
              <div className="w-2 h-2 bg-accent rounded-full" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedDNS('google')
              updateConfig({ dns_servers: DNS_SERVERS.google })
            }}
            className={`w-full flex items-center justify-between p-3 rounded-xl transition-colors ${
              selectedDNS === 'google'
                ? 'bg-accent/10 border border-accent/30'
                : 'bg-surface-elevated hover:bg-surface-hover'
            }`}
          >
            <span className={selectedDNS === 'google' ? 'font-medium' : ''}>
              Google (8.8.8.8)
            </span>
            {selectedDNS === 'google' && (
              <div className="w-2 h-2 bg-accent rounded-full" />
            )}
          </button>
        </div>
      </div>

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
    </div>
  )
}
