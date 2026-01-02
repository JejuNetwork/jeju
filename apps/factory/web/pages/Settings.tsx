import { clsx } from 'clsx'
import {
  Bell,
  Eye,
  Key,
  Palette,
  Settings,
  Shield,
  User,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { Button, PageHeader } from '../components/shared'
import { formatAddress } from '../lib/format'

type SettingsTab =
  | 'profile'
  | 'wallet'
  | 'notifications'
  | 'appearance'
  | 'security'
  | 'api'

const tabs = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api', label: 'API Keys', icon: Key },
] as const

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [bio, setBio] = useState('')

  const [emailNotifications, setEmailNotifications] = useState(true)
  const [bountyAlerts, setBountyAlerts] = useState(true)
  const [jobAlerts, setJobAlerts] = useState(false)
  const [messageNotifications, setMessageNotifications] = useState(true)

  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')

  return (
    <div className="page-container">
      <PageHeader
        title="Settings"
        icon={Settings}
        iconColor="text-surface-400"
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <nav className="card p-2 space-y-1 animate-in">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab.id
                    ? 'bg-factory-500/15 text-factory-400'
                    : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800',
                )}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-6">
          {activeTab === 'profile' && (
            <div className="card p-6 animate-in">
              <h3 className="font-semibold text-surface-100 mb-6">
                Profile Settings
              </h3>

              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-factory-500 to-accent-500 flex items-center justify-center">
                    <User className="w-10 h-10 text-white" />
                  </div>
                  <div>
                    <Button variant="secondary" size="sm">
                      Upload Photo
                    </Button>
                    <p className="text-xs text-surface-500 mt-1">
                      JPG, PNG or GIF. Max 2MB.
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="displayName"
                    className="block text-sm font-medium text-surface-300 mb-2"
                  >
                    Display Name
                  </label>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="input w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-surface-300 mb-2"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bio"
                    className="block text-sm font-medium text-surface-300 mb-2"
                  >
                    Bio
                  </label>
                  <textarea
                    id="bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Tell us about yourself..."
                    className="input w-full min-h-[100px] resize-y"
                  />
                </div>

                <div className="flex justify-end">
                  <Button variant="primary">Save Changes</Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'wallet' && (
            <div className="card p-6 animate-in">
              <h3 className="font-semibold text-surface-100 mb-6">
                Wallet Settings
              </h3>

              {isConnected ? (
                <div className="space-y-4">
                  <div className="p-4 bg-surface-800/50 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-factory-500 to-accent-500 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium text-surface-100">
                          {formatAddress(address ?? '', 6)}
                        </p>
                        <p className="text-sm text-surface-500">Connected</p>
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => disconnect()}
                    >
                      Disconnect
                    </Button>
                  </div>

                  <div className="p-4 bg-surface-800/50 rounded-lg">
                    <h4 className="font-medium text-surface-200 mb-2">
                      Connected Networks
                    </h4>
                    <div className="flex gap-2">
                      <span className="badge badge-success">Jeju L2</span>
                      <span className="badge badge-neutral">Ethereum</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Wallet className="w-12 h-12 text-surface-600 mx-auto mb-4" />
                  <p className="text-surface-400 mb-4">No wallet connected</p>
                  <Button variant="primary">Connect Wallet</Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="card p-6 animate-in">
              <h3 className="font-semibold text-surface-100 mb-6">
                Notification Settings
              </h3>

              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg cursor-pointer">
                  <div>
                    <p className="font-medium text-surface-200">
                      Email Notifications
                    </p>
                    <p className="text-sm text-surface-500">
                      Receive email updates about your activity
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={emailNotifications}
                    onChange={(e) => setEmailNotifications(e.target.checked)}
                    className="w-5 h-5 rounded border-surface-600 bg-surface-800 text-factory-500 focus:ring-factory-500"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg cursor-pointer">
                  <div>
                    <p className="font-medium text-surface-200">
                      Bounty Alerts
                    </p>
                    <p className="text-sm text-surface-500">
                      Get notified about new bounties matching your skills
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={bountyAlerts}
                    onChange={(e) => setBountyAlerts(e.target.checked)}
                    className="w-5 h-5 rounded border-surface-600 bg-surface-800 text-factory-500 focus:ring-factory-500"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg cursor-pointer">
                  <div>
                    <p className="font-medium text-surface-200">Job Alerts</p>
                    <p className="text-sm text-surface-500">
                      Get notified about new job postings
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={jobAlerts}
                    onChange={(e) => setJobAlerts(e.target.checked)}
                    className="w-5 h-5 rounded border-surface-600 bg-surface-800 text-factory-500 focus:ring-factory-500"
                  />
                </label>

                <label className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg cursor-pointer">
                  <div>
                    <p className="font-medium text-surface-200">
                      Message Notifications
                    </p>
                    <p className="text-sm text-surface-500">
                      Get notified about new messages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={messageNotifications}
                    onChange={(e) => setMessageNotifications(e.target.checked)}
                    className="w-5 h-5 rounded border-surface-600 bg-surface-800 text-factory-500 focus:ring-factory-500"
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="card p-6 animate-in">
              <h3 className="font-semibold text-surface-100 mb-6">
                Appearance Settings
              </h3>

              <div className="space-y-4">
                <fieldset>
                  <legend className="block text-sm font-medium text-surface-300 mb-3">
                    Theme
                  </legend>
                  <div className="grid grid-cols-3 gap-3">
                    {(['dark', 'light', 'system'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTheme(t)}
                        className={clsx(
                          'p-4 rounded-lg border-2 text-center capitalize transition-all',
                          theme === t
                            ? 'border-factory-500 bg-factory-500/10'
                            : 'border-surface-700 hover:border-surface-600',
                        )}
                      >
                        <Eye className="w-6 h-6 mx-auto mb-2 text-surface-400" />
                        <span className="text-sm text-surface-200">{t}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="card p-6 animate-in">
              <h3 className="font-semibold text-surface-100 mb-6">
                Security Settings
              </h3>

              <div className="space-y-4">
                <div className="p-4 bg-surface-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="font-medium text-surface-200">
                        Two-Factor Authentication
                      </p>
                      <p className="text-sm text-surface-500">
                        Add an extra layer of security
                      </p>
                    </div>
                    <Button variant="secondary" size="sm">
                      Enable
                    </Button>
                  </div>
                </div>

                <div className="p-4 bg-surface-800/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-surface-200">
                        Active Sessions
                      </p>
                      <p className="text-sm text-surface-500">
                        Manage your active sessions
                      </p>
                    </div>
                    <Button variant="ghost" size="sm">
                      View All
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'api' && (
            <div className="card p-6 animate-in">
              <h3 className="font-semibold text-surface-100 mb-6">API Keys</h3>

              <div className="space-y-4">
                <p className="text-surface-400 text-sm">
                  API keys allow you to interact with Factory programmatically.
                </p>

                <Button variant="primary" icon={Key}>
                  Generate New API Key
                </Button>

                <div className="border-t border-surface-800 pt-4 mt-4">
                  <p className="text-surface-500 text-sm text-center py-8">
                    No API keys generated yet
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
