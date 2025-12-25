/**
 * Settings View
 * Wallet settings and security options
 */

import {
  AlertCircle,
  Bell,
  Check,
  ChevronRight,
  Globe,
  Key,
  Link2,
  Loader2,
  Shield,
  Usb,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  type HardwareDevice,
  type HardwareWalletType,
  hardwareWalletService,
} from '../../../api/services/hardware'
import {
  SUPPORTED_CHAINS,
  type SupportedChainId,
} from '../../../api/services/rpc'
import { swapService } from '../../../api/services/swap'
import { LinkedAccounts } from '../auth'

interface SettingSection {
  id: string
  title: string
  description: string
  icon: React.ElementType
}

const SECTIONS: SettingSection[] = [
  {
    id: 'accounts',
    title: 'Linked Accounts',
    description: 'Social login & recovery options',
    icon: Link2,
  },
  {
    id: 'security',
    title: 'Security',
    description: 'Transaction protection and approvals',
    icon: Shield,
  },
  {
    id: 'hardware',
    title: 'Hardware Wallet',
    description: 'Connect Ledger or Trezor',
    icon: Usb,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Alerts and updates',
    icon: Bell,
  },
  {
    id: 'networks',
    title: 'Networks',
    description: 'Supported chains',
    icon: Globe,
  },
  {
    id: 'advanced',
    title: 'Advanced',
    description: 'Slippage, MEV protection',
    icon: Key,
  },
]

export function SettingsView() {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [settings, setSettings] = useState({
    transactionSimulation: true,
    approvalWarnings: true,
    scamProtection: true,
    txNotifications: true,
    priceAlerts: false,
    slippage: swapService.getSlippage(),
    mevProtection: swapService.getMevProtection(),
    enabledChains: Object.keys(SUPPORTED_CHAINS).map(
      Number,
    ) as SupportedChainId[],
  })

  // Hardware wallet state
  const [hwDevice, setHwDevice] = useState<HardwareDevice | null>(null)
  const [hwConnecting, setHwConnecting] = useState(false)
  const [hwError, setHwError] = useState<string | null>(null)

  const updateSetting = <K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))

    if (key === 'slippage') swapService.setSlippage(value as number)
    if (key === 'mevProtection') swapService.setMevProtection(value as boolean)
  }

  const connectHardwareWallet = useCallback(
    async (type: HardwareWalletType) => {
      setHwConnecting(true)
      setHwError(null)

      try {
        let device: HardwareDevice
        if (type === 'ledger') {
          device = await hardwareWalletService.connectLedger()
        } else {
          device = await hardwareWalletService.connectTrezor()
        }
        setHwDevice(device)
      } catch (error) {
        setHwError((error as Error).message)
      } finally {
        setHwConnecting(false)
      }
    },
    [],
  )

  const disconnectHardwareWallet = useCallback(async () => {
    await hardwareWalletService.disconnect()
    setHwDevice(null)
  }, [])

  const renderSection = () => {
    switch (activeSection) {
      case 'accounts':
        return <LinkedAccounts />

      case 'security':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Security Settings</h3>

            <SettingToggle
              title="Transaction Simulation"
              description="Simulate transactions before signing to detect potential issues"
              enabled={settings.transactionSimulation}
              onChange={(v) => updateSetting('transactionSimulation', v)}
            />

            <SettingToggle
              title="Approval Warnings"
              description="Warn before granting unlimited token approvals"
              enabled={settings.approvalWarnings}
              onChange={(v) => updateSetting('approvalWarnings', v)}
            />

            <SettingToggle
              title="Scam Protection"
              description="Check addresses against known scam database"
              enabled={settings.scamProtection}
              onChange={(v) => updateSetting('scamProtection', v)}
            />
          </div>
        )

      case 'hardware':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Hardware Wallet</h3>
            <p className="text-sm text-muted-foreground">
              Connect a hardware wallet for maximum security. Your keys never
              leave the device.
            </p>

            {!hardwareWalletService.isSupported() && (
              <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-500">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-sm">
                  WebHID is not supported in this browser. Try Chrome or Edge.
                </span>
              </div>
            )}

            {hwDevice ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                        <Usb className="w-5 h-5 text-emerald-500" />
                      </div>
                      <div>
                        <div className="font-medium text-emerald-500">
                          {hwDevice.model}
                        </div>
                        <div className="text-xs text-emerald-500/70">
                          Connected
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={disconnectHardwareWallet}
                      className="px-4 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded-lg"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  Your hardware wallet is ready to sign transactions. Select it
                  as the signer when performing actions.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => connectHardwareWallet('ledger')}
                  disabled={
                    hwConnecting || !hardwareWalletService.isSupported()
                  }
                  className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                      <span className="text-lg">🔷</span>
                    </div>
                    <div className="text-left">
                      <div className="font-medium">Ledger</div>
                      <div className="text-xs text-muted-foreground">
                        Connect via USB
                      </div>
                    </div>
                  </div>
                  {hwConnecting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => connectHardwareWallet('trezor')}
                  disabled={hwConnecting}
                  className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
                      <span className="text-lg">🟢</span>
                    </div>
                    <div className="text-left">
                      <div className="font-medium">Trezor</div>
                      <div className="text-xs text-muted-foreground">
                        Connect via USB
                      </div>
                    </div>
                  </div>
                  {hwConnecting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>

                {hwError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    {hwError}
                  </div>
                )}
              </div>
            )}
          </div>
        )

      case 'notifications':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Notifications</h3>

            <SettingToggle
              title="Transaction Notifications"
              description="Get notified when transactions complete or fail"
              enabled={settings.txNotifications}
              onChange={(v) => updateSetting('txNotifications', v)}
            />

            <SettingToggle
              title="Price Alerts"
              description="Get notified of significant price movements"
              enabled={settings.priceAlerts}
              onChange={(v) => updateSetting('priceAlerts', v)}
            />
          </div>
        )

      case 'networks':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Supported Networks</h3>
            <p className="text-sm text-muted-foreground">
              All chains are shown in a unified view. No chain switching needed.
            </p>

            <div className="space-y-3">
              {(
                Object.entries(SUPPORTED_CHAINS) as [
                  string,
                  (typeof SUPPORTED_CHAINS)[SupportedChainId],
                ][]
              ).map(([id, chain]) => {
                const chainId = Number(id) as SupportedChainId
                const isEnabled = settings.enabledChains.includes(chainId)

                return (
                  <div
                    key={chainId}
                    className="flex items-center justify-between p-4 bg-card border border-border rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-xs font-medium text-primary">
                          {chain.nativeCurrency.symbol.slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium">{chain.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Chain ID: {chainId}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center ${isEnabled ? 'bg-emerald-500' : 'bg-secondary'}`}
                    >
                      {isEnabled && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )

      case 'advanced':
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Advanced Settings</h3>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="slippage-select"
                  className="block text-sm font-medium mb-2"
                >
                  Default Slippage
                </label>
                <div className="flex gap-2">
                  {[0.1, 0.5, 1.0, 3.0].map((val) => (
                    <button
                      type="button"
                      key={val}
                      onClick={() => updateSetting('slippage', val)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        settings.slippage === val
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary hover:bg-secondary/80'
                      }`}
                    >
                      {val}%
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Higher slippage = more likely to succeed, but potentially
                  worse price
                </p>
              </div>

              <SettingToggle
                title="MEV Protection"
                description="Send swaps through the network's private mempool to prevent front-running"
                enabled={settings.mevProtection}
                onChange={(v) => updateSetting('mevProtection', v)}
              />
            </div>
          </div>
        )

      default:
        return null
    }
  }

  if (activeSection) {
    return (
      <div className="h-full overflow-auto p-6">
        <button
          type="button"
          onClick={() => setActiveSection(null)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Settings
        </button>
        {renderSection()}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-muted-foreground">Manage your wallet preferences</p>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <button
              type="button"
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className="w-full flex items-center justify-between p-4 bg-card border border-border rounded-xl hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="text-left">
                  <div className="font-medium">{section.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {section.description}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          )
        })}
      </div>

      <div className="pt-6 border-t border-border">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Network Wallet v0.1.0</span>
          <span>Powered by the network</span>
        </div>
      </div>
    </div>
  )
}

function SettingToggle({
  title,
  description,
  enabled,
  onChange,
}: {
  title: string
  description: string
  enabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-card border border-border rounded-xl">
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          enabled ? 'bg-emerald-500' : 'bg-secondary'
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
            enabled ? 'translate-x-7' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

export default SettingsView
