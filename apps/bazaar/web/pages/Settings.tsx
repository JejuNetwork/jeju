/**
 * Settings Page
 *
 * User profile and preferences
 */

import { ArrowLeft, Palette, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { AuthButton } from '../components/auth/AuthButton'
import { LoadingSpinner } from '../components/LoadingSpinner'

type Tab = 'profile' | 'theme'
type ThemeOption = 'light' | 'dark' | 'system'

const TABS = [
  { id: 'profile' as const, label: 'Profile', icon: User },
  { id: 'theme' as const, label: 'Theme', icon: Palette },
]

const THEME_OPTIONS: Array<{
  value: ThemeOption
  label: string
  description: string
}> = [
  {
    value: 'light',
    label: 'Light',
    description: 'Light background with dark text',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Dark background with light text',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Match your device settings',
  },
]

export default function SettingsPage() {
  const navigate = useNavigate()
  const { address, isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [theme, setTheme] = useState<ThemeOption>('system')
  const [isSaving, setIsSaving] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Load saved theme preference
    const savedTheme = localStorage.getItem(
      'bazaar-theme',
    ) as ThemeOption | null
    if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
      setTheme(savedTheme)
    }
  }, [])

  const handleThemeChange = useCallback((newTheme: ThemeOption) => {
    setTheme(newTheme)
    localStorage.setItem('bazaar-theme', newTheme)
    // Apply theme
    if (newTheme === 'system') {
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches
      document.documentElement.classList.toggle('dark', prefersDark)
    } else {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!address) return
    setIsSaving(true)
    // Profile update would go here
    setTimeout(() => setIsSaving(false), 1000)
  }, [address])

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20 animate-fade-in">
        <div className="text-6xl mb-4 animate-float" aria-hidden="true">
          ⚙️
        </div>
        <h1 className="text-2xl font-bold text-primary mb-4">Settings</h1>
        <p className="text-secondary mb-8">
          Connect your wallet to access settings
        </p>
        <AuthButton />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Back Button */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors group"
      >
        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
        Back
      </button>

      {/* Header */}
      <h1 className="text-2xl sm:text-3xl font-bold text-primary mb-8">
        Settings
      </h1>

      {/* Tab Navigation */}
      <nav
        className="flex gap-2 border-b mb-8"
        style={{ borderColor: 'var(--border)' }}
        aria-label="Settings sections"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-all focus-ring ${
                isActive
                  ? 'border-primary-color text-primary-color'
                  : 'border-transparent text-secondary hover:text-primary'
              }`}
              style={{
                borderColor: isActive ? 'var(--color-primary)' : 'transparent',
              }}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <section
          className="space-y-6 animate-fade-in"
          role="tabpanel"
          aria-labelledby="profile-tab"
        >
          <div>
            <label
              htmlFor="displayName"
              className="block text-sm font-medium text-primary mb-2"
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
              className="block text-sm font-medium text-primary mb-2"
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
        </section>
      )}

      {/* Theme Tab */}
      {activeTab === 'theme' && mounted && (
        <section
          className="space-y-4 animate-fade-in"
          role="tabpanel"
          aria-labelledby="theme-tab"
        >
          <h2 className="text-lg font-medium text-primary mb-4">
            Theme Preference
          </h2>
          <fieldset>
            <legend className="sr-only">Select theme</legend>
            {THEME_OPTIONS.map((option) => (
              <label
                key={option.value}
                htmlFor={`theme-${option.value}`}
                className={`flex items-center gap-3 p-4 card cursor-pointer mb-3 ${
                  theme === option.value ? 'border-primary-color' : ''
                }`}
                style={{
                  borderColor:
                    theme === option.value ? 'var(--color-primary)' : undefined,
                }}
              >
                <input
                  id={`theme-${option.value}`}
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={theme === option.value}
                  onChange={() => handleThemeChange(option.value)}
                  className="h-4 w-4 accent-[var(--color-primary)]"
                />
                <div>
                  <p className="font-medium text-primary capitalize">
                    {option.label}
                  </p>
                  <p className="text-sm text-secondary">{option.description}</p>
                </div>
              </label>
            ))}
          </fieldset>
        </section>
      )}
    </div>
  )
}
