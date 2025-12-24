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
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { invoke } from '../../lib'

const BooleanResponseSchema = z.boolean()

export function SettingsPanel() {
  const [killSwitch, setKillSwitch] = useState(true)
  const [autoConnect, setAutoConnect] = useState(false)
  const [autoStart, setAutoStart] = useState(false)

  useEffect(() => {
    invoke('get_autostart_enabled', {}, BooleanResponseSchema).then(
      setAutoStart,
    )
  }, [])

  const [minimizeToTray, setMinimizeToTray] = useState(true)
  const [adaptiveMode, setAdaptiveMode] = useState(true)
  const [dwsEnabled, setDwsEnabled] = useState(true)

  const updateSetting = async (key: string, value: boolean) => {
    await invoke('update_settings', { key, value })
  }

  const toggleAdaptive = async () => {
    const newValue = !adaptiveMode
    setAdaptiveMode(newValue)
    await invoke('set_adaptive_mode', { enabled: newValue })
  }

  const toggleDws = async () => {
    const newValue = !dwsEnabled
    setDwsEnabled(newValue)
    await invoke('set_dws_enabled', { enabled: newValue })
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
              onClick={() => setKillSwitch(!killSwitch)}
              className={`w-12 h-6 rounded-full transition-colors ${
                killSwitch ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  killSwitch ? 'translate-x-6' : 'translate-x-0.5'
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
              onClick={() => {
                setAutoConnect(!autoConnect)
                updateSetting('auto_connect', !autoConnect)
              }}
              className={`w-12 h-6 rounded-full transition-colors ${
                autoConnect ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  autoConnect ? 'translate-x-6' : 'translate-x-0.5'
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
                const result = await invoke(
                  'toggle_autostart',
                  {},
                  BooleanResponseSchema,
                )
                setAutoStart(result)
              }}
              className={`w-12 h-6 rounded-full transition-colors ${
                autoStart ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  autoStart ? 'translate-x-6' : 'translate-x-0.5'
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
              onClick={() => {
                setMinimizeToTray(!minimizeToTray)
                updateSetting('minimize_to_tray', !minimizeToTray)
              }}
              className={`w-12 h-6 rounded-full transition-colors ${
                minimizeToTray ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  minimizeToTray ? 'translate-x-6' : 'translate-x-0.5'
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
                adaptiveMode ? 'bg-[#00ff88]' : 'bg-[#2a2a35]'
              }`}
            >
              <div
                className={`w-5 h-5 bg-white rounded-full transition-transform ${
                  adaptiveMode ? 'translate-x-6' : 'translate-x-0.5'
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
