import React, { useState } from 'react'
import {
  DiscordIcon,
  TelegramIcon,
  FarcasterIcon,
  CheckIcon,
  ArrowRightIcon,
  SettingsIcon,
} from '../components/Icons'

interface Props {
  onNavigate: (page: 'landing' | 'onboard' | 'configure' | 'chat') => void
  sessionId: string | null
}

interface TradingSettings {
  maxSlippage: string
  defaultChain: string
  gasPreference: 'low' | 'medium' | 'high'
  confirmTrades: boolean
  notifications: boolean
}

export function Configure({ onNavigate, sessionId }: Props) {
  const [activeTab, setActiveTab] = useState<'platforms' | 'trading' | 'notifications'>('platforms')
  const [settings, setSettings] = useState<TradingSettings>({
    maxSlippage: '0.5',
    defaultChain: 'base',
    gasPreference: 'medium',
    confirmTrades: true,
    notifications: true,
  })

  const updateSettings = (key: keyof TradingSettings, value: string | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const saveSettings = async () => {
    // Save to API
    await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId ?? '',
      },
      body: JSON.stringify(settings),
    })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-pattern" />
      <div className="grid-pattern" />

      {/* Header */}
      <header className="relative z-10 border-b border-surface-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => onNavigate('landing')}
            className="flex items-center gap-3 text-otto-cyan font-bold text-xl"
          >
            <div className="w-9 h-9 bg-gradient-to-br from-otto-cyan to-otto-purple rounded-xl flex items-center justify-center text-sm shadow-lg shadow-otto-cyan/30">
              O
            </div>
            Otto
          </button>

          <button onClick={() => onNavigate('chat')} className="btn-primary">
            Start Chatting
            <span className="w-5 h-5">
              <ArrowRightIcon />
            </span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 relative z-10">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 bg-otto-cyan/20 rounded-xl flex items-center justify-center">
              <span className="w-6 h-6 text-otto-cyan">
                <SettingsIcon />
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Configure Otto</h1>
              <p className="text-white/60">Set up your platforms and trading preferences</p>
            </div>
          </div>

          <div className="grid lg:grid-cols-4 gap-8">
            {/* Sidebar */}
            <div className="lg:col-span-1">
              <nav className="space-y-2">
                <TabButton
                  active={activeTab === 'platforms'}
                  onClick={() => setActiveTab('platforms')}
                >
                  Platforms
                </TabButton>
                <TabButton
                  active={activeTab === 'trading'}
                  onClick={() => setActiveTab('trading')}
                >
                  Trading
                </TabButton>
                <TabButton
                  active={activeTab === 'notifications'}
                  onClick={() => setActiveTab('notifications')}
                >
                  Notifications
                </TabButton>
              </nav>
            </div>

            {/* Main content */}
            <div className="lg:col-span-3">
              {activeTab === 'platforms' && <PlatformsTab />}
              {activeTab === 'trading' && (
                <TradingTab settings={settings} updateSettings={updateSettings} />
              )}
              {activeTab === 'notifications' && (
                <NotificationsTab settings={settings} updateSettings={updateSettings} />
              )}

              <div className="mt-8 flex justify-end">
                <button
                  onClick={saveSettings}
                  className="btn-primary"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl font-medium transition-all ${
        active
          ? 'bg-otto-cyan/10 text-otto-cyan border border-otto-cyan/30'
          : 'text-white/60 hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  )
}

function PlatformsTab() {
  const platforms = [
    {
      id: 'telegram',
      name: 'Telegram',
      icon: <TelegramIcon />,
      description: 'Chat with Otto in Telegram',
      action: 'Add to Telegram',
      url: 'https://t.me/otto_jeju_bot',
      connected: false,
    },
    {
      id: 'discord',
      name: 'Discord',
      icon: <DiscordIcon />,
      description: 'Add Otto bot to your Discord server',
      action: 'Add to Discord',
      url: 'https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID',
      connected: false,
    },
    {
      id: 'farcaster',
      name: 'Farcaster',
      icon: <FarcasterIcon />,
      description: 'Trade via Farcaster frames',
      action: 'Connect Farcaster',
      url: '#',
      connected: false,
    },
  ]

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h2 className="text-xl font-bold mb-2">Platform Connections</h2>
        <p className="text-white/60">
          Connect Otto to your favorite platforms to start trading anywhere.
        </p>
      </div>

      <div className="space-y-4">
        {platforms.map((platform) => (
          <div key={platform.id} className="card flex items-center gap-4">
            <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="w-6 h-6">{platform.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold">{platform.name}</h3>
              <p className="text-white/60 text-sm">{platform.description}</p>
            </div>
            {platform.connected ? (
              <div className="flex items-center gap-2 text-otto-green">
                <span className="w-5 h-5">
                  <CheckIcon />
                </span>
                Connected
              </div>
            ) : (
              <a
                href={platform.url}
                target="_blank"
                rel="noopener"
                className="btn-secondary text-sm py-2 px-4"
              >
                {platform.action}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TradingTab({
  settings,
  updateSettings,
}: {
  settings: TradingSettings
  updateSettings: (key: keyof TradingSettings, value: string | boolean) => void
}) {
  const chains = [
    { id: 'base', name: 'Base' },
    { id: 'ethereum', name: 'Ethereum' },
    { id: 'optimism', name: 'Optimism' },
    { id: 'arbitrum', name: 'Arbitrum' },
    { id: 'solana', name: 'Solana' },
  ]

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h2 className="text-xl font-bold mb-2">Trading Settings</h2>
        <p className="text-white/60">
          Configure your default trading preferences.
        </p>
      </div>

      <div className="space-y-6">
        {/* Max Slippage */}
        <div className="card">
          <label className="block font-semibold mb-2">Max Slippage</label>
          <p className="text-white/60 text-sm mb-4">
            Maximum price slippage allowed for swaps
          </p>
          <div className="flex gap-3">
            {['0.1', '0.5', '1.0', '3.0'].map((val) => (
              <button
                key={val}
                onClick={() => updateSettings('maxSlippage', val)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  settings.maxSlippage === val
                    ? 'bg-otto-cyan text-black'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
        </div>

        {/* Default Chain */}
        <div className="card">
          <label className="block font-semibold mb-2">Default Chain</label>
          <p className="text-white/60 text-sm mb-4">
            Preferred chain for trading operations
          </p>
          <select
            value={settings.defaultChain}
            onChange={(e) => updateSettings('defaultChain', e.target.value)}
            className="input"
          >
            {chains.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>

        {/* Gas Preference */}
        <div className="card">
          <label className="block font-semibold mb-2">Gas Preference</label>
          <p className="text-white/60 text-sm mb-4">
            How much to pay for faster transactions
          </p>
          <div className="flex gap-3">
            {[
              { id: 'low', label: 'Low', desc: 'Slower' },
              { id: 'medium', label: 'Medium', desc: 'Balanced' },
              { id: 'high', label: 'High', desc: 'Faster' },
            ].map((option) => (
              <button
                key={option.id}
                onClick={() =>
                  updateSettings('gasPreference', option.id as 'low' | 'medium' | 'high')
                }
                className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all text-center ${
                  settings.gasPreference === option.id
                    ? 'bg-otto-cyan text-black'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <span className="block">{option.label}</span>
                <span className="text-xs opacity-70">{option.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Confirm Trades */}
        <div className="card flex items-center justify-between">
          <div>
            <label className="block font-semibold">Confirm Trades</label>
            <p className="text-white/60 text-sm">
              Ask for confirmation before executing trades
            </p>
          </div>
          <ToggleSwitch
            enabled={settings.confirmTrades}
            onChange={(enabled) => updateSettings('confirmTrades', enabled)}
          />
        </div>
      </div>
    </div>
  )
}

function NotificationsTab({
  settings,
  updateSettings,
}: {
  settings: TradingSettings
  updateSettings: (key: keyof TradingSettings, value: string | boolean) => void
}) {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h2 className="text-xl font-bold mb-2">Notifications</h2>
        <p className="text-white/60">
          Configure how Otto notifies you about trades and activity.
        </p>
      </div>

      <div className="space-y-4">
        <div className="card flex items-center justify-between">
          <div>
            <label className="block font-semibold">Trade Notifications</label>
            <p className="text-white/60 text-sm">
              Get notified when trades execute
            </p>
          </div>
          <ToggleSwitch
            enabled={settings.notifications}
            onChange={(enabled) => updateSettings('notifications', enabled)}
          />
        </div>

        <div className="card flex items-center justify-between">
          <div>
            <label className="block font-semibold">Price Alerts</label>
            <p className="text-white/60 text-sm">
              Notifications for limit order fills
            </p>
          </div>
          <ToggleSwitch enabled={true} onChange={() => {}} />
        </div>

        <div className="card flex items-center justify-between">
          <div>
            <label className="block font-semibold">Market Updates</label>
            <p className="text-white/60 text-sm">
              Significant price movements for watched tokens
            </p>
          </div>
          <ToggleSwitch enabled={false} onChange={() => {}} />
        </div>
      </div>
    </div>
  )
}

function ToggleSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative w-12 h-6 rounded-full transition-all ${
        enabled ? 'bg-otto-cyan' : 'bg-white/20'
      }`}
    >
      <span
        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${
          enabled ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  )
}
