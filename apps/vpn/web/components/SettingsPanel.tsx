import {
  ChevronRight,
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

/** Settings schema matching Rust VPNConfig */
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
      <div className="p-6 flex items-center justify-center">
        <div className="text-[#606070]">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-[#606070] mt-1">
          Configure your VPN experience
        </p>
      </div>

      <div className="card">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#00ff88]" />
          Connection
        </h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Kill Switch</div>
              <div className="text-xs text-[#606070]">
                Block internet if VPN disconnects
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateConfig({ kill_switch: !config.kill_switch })}
              className={`w-12 h-6 rounded-full transition-colors ${
                config.kill_switch ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  config.kill_switch ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto Connect</div>
              <div className="text-xs text-[#606070]">
                Connect when app starts
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                updateConfig({ auto_connect: !config.auto_connect })
              }
              className={`w-12 h-6 rounded-full transition-colors ${
                config.auto_connect ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  config.auto_connect ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Power className="w-4 h-4 text-[#00cc6a]" />
          Startup
        </h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Start on Boot</div>
              <div className="text-xs text-[#606070]">
                Launch VPN when system starts
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const newValue = !config.auto_start
                await updateConfig({ auto_start: newValue })
                await invoke('toggle_autostart', {}, BooleanResponseSchema)
              }}
              className={`w-12 h-6 rounded-full transition-colors ${
                config.auto_start ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  config.auto_start ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Minimize to Tray</div>
              <div className="text-xs text-[#606070]">
                Keep running in system tray
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                updateConfig({ minimize_to_tray: !config.minimize_to_tray })
              }
              className={`w-12 h-6 rounded-full transition-colors ${
                config.minimize_to_tray ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  config.minimize_to_tray ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#00cc6a]" />
          Protocol
        </h3>

        <div className="space-y-2">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-[#00ff88]/10 border border-[#00ff88]/30 rounded-xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-[#00ff88] rounded-full" />
              <span>WireGuard</span>
            </div>
            <span className="text-xs text-[#00ff88]">Recommended</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-[#1a1a25] rounded-xl opacity-50"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 bg-[#606070] rounded-full" />
              <span>SOCKS5 Proxy</span>
            </div>
            <span className="text-xs text-[#606070]">Browser only</span>
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-[#00aa55]" />
          Bandwidth Management
        </h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Adaptive Bandwidth</div>
              <div className="text-xs text-[#606070]">
                Share more when idle (up to 80%)
              </div>
            </div>
            <button
              type="button"
              onClick={toggleAdaptive}
              className={`w-12 h-6 rounded-full transition-colors ${
                config.adaptive_bandwidth ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  config.adaptive_bandwidth
                    ? 'translate-x-6'
                    : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Edge CDN Caching</div>
              <div className="text-xs text-[#606070]">
                Cache and serve DWS content
              </div>
            </div>
            <button
              type="button"
              onClick={toggleDws}
              className={`w-12 h-6 rounded-full transition-colors ${
                dwsEnabled ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  dwsEnabled ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#606070]" />
          DNS Servers
        </h3>

        <div className="space-y-2">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-[#00ff88]/10 border border-[#00ff88]/30 rounded-xl"
          >
            <span>Cloudflare (1.1.1.1)</span>
            <div className="w-2 h-2 bg-[#00ff88] rounded-full" />
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-[#1a1a25] rounded-xl"
          >
            <span>Google (8.8.8.8)</span>
          </button>
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 bg-[#1a1a25] rounded-xl"
          >
            <span>Custom</span>
            <ChevronRight className="w-4 h-4 text-[#606070]" />
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Info className="w-4 h-4 text-[#606070]" />
          About
        </h3>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#606070]">Version</span>
            <span>0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#606070]">Network</span>
            <span>Jeju Mainnet</span>
          </div>
          <a
            href="https://jejunetwork.org"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between text-[#00ff88] hover:underline"
          >
            <span>Learn More</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  )
}
