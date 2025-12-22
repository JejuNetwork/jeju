/**
 * Settings Page
 * Converted from Next.js to React Router
 */

import { ArrowLeft, Palette, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { AuthButton } from '../../components/auth/AuthButton'
import { LoadingSpinner } from '../../components/LoadingSpinner'

type Tab = 'profile' | 'theme'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [isSaving, setIsSaving] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Load saved theme preference
    const savedTheme = localStorage.getItem('theme') as
      | 'light'
      | 'dark'
      | 'system'
      | null
    if (savedTheme) {
      setTheme(savedTheme)
    }
  }, [])

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    // Apply theme
    if (newTheme === 'system') {
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches
      document.documentElement.classList.toggle('dark', prefersDark)
    } else {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    }
  }

  const handleSave = async () => {
    if (!address) return
    setIsSaving(true)
    // Profile update would go here
    setTimeout(() => setIsSaving(false), 1000)
  }

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <h1
          className="text-2xl font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Settings
        </h1>
        <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>
          Connect your wallet to access settings
        </p>
        <AuthButton />
      </div>
    )
  }

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'theme' as const, label: 'Theme', icon: Palette },
  ]

  return (
    <div className="max-w-2xl mx-auto">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-2 text-sm"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1
        className="text-3xl font-bold mb-8"
        style={{ color: 'var(--text-primary)' }}
      >
        Settings
      </h1>

      <div
        className="flex gap-2 border-b mb-8"
        style={{ borderColor: 'var(--border)' }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-bazaar-primary'
                  : 'border-transparent'
              }`}
              style={{
                color:
                  activeTab === tab.id
                    ? 'var(--bazaar-primary)'
                    : 'var(--text-secondary)',
              }}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'profile' && (
        <div className="space-y-6">
          <div>
            <label
              htmlFor="displayName"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input w-full"
              placeholder="Enter your display name"
            />
          </div>

          <div>
            <label
              htmlFor="bio"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              className="input w-full resize-none"
              placeholder="Tell us about yourself..."
            />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary px-6 py-3 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <LoadingSpinner size="sm" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      )}

      {activeTab === 'theme' && mounted && (
        <div className="space-y-4">
          <h2
            className="text-lg font-medium mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Theme Preference
          </h2>
          {(['light', 'dark', 'system'] as const).map((themeOption) => (
            <label
              key={themeOption}
              htmlFor={`theme-${themeOption}`}
              className="flex items-center gap-3 p-4 card cursor-pointer"
            >
              <input
                id={`theme-${themeOption}`}
                type="radio"
                name="theme"
                value={themeOption}
                checked={theme === themeOption}
                onChange={() => handleThemeChange(themeOption)}
                className="h-4 w-4"
              />
              <div>
                <p
                  className="font-medium capitalize"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {themeOption}
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {themeOption === 'light' && 'Light background with dark text'}
                  {themeOption === 'dark' && 'Dark background with light text'}
                  {themeOption === 'system' && 'Match your system settings'}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
