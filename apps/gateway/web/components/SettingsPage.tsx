import {
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Globe,
  HelpCircle,
  Info,
  type LucideProps,
  Moon,
  RotateCcw,
  Settings,
  Shield,
  Sun,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useTheme } from './ThemeProvider'

const BellIcon = Bell as ComponentType<LucideProps>
const BookOpenIcon = BookOpen as ComponentType<LucideProps>
const CheckIcon = Check as ComponentType<LucideProps>
const ChevronRightIcon = ChevronRight as ComponentType<LucideProps>
const GlobeIcon = Globe as ComponentType<LucideProps>
const HelpCircleIcon = HelpCircle as ComponentType<LucideProps>
const InfoIcon = Info as ComponentType<LucideProps>
const MoonIcon = Moon as ComponentType<LucideProps>
const RotateCcwIcon = RotateCcw as ComponentType<LucideProps>
const SettingsIcon = Settings as ComponentType<LucideProps>
const ShieldIcon = Shield as ComponentType<LucideProps>
const SunIcon = Sun as ComponentType<LucideProps>

interface NetworkOption {
  id: string
  name: string
  chainId: number
  icon: string
  rpcUrl: string
  isTestnet: boolean
}

const NETWORKS: NetworkOption[] = [
  {
    id: 'jeju-mainnet',
    name: 'Jeju Mainnet',
    chainId: 420691,
    icon: '🏝️',
    rpcUrl: 'https://rpc.jeju.network',
    isTestnet: false,
  },
  {
    id: 'jeju-testnet',
    name: 'Jeju Testnet',
    chainId: 420690,
    icon: '🧪',
    rpcUrl: 'https://testnet.rpc.jeju.network',
    isTestnet: true,
  },
  {
    id: 'localhost',
    name: 'Local Development',
    chainId: 31337,
    icon: '💻',
    rpcUrl: 'http://localhost:8545',
    isTestnet: true,
  },
]

const NOTIFICATION_STORAGE_KEY = 'jeju-gateway-notifications'
const ONBOARDING_STORAGE_KEY = 'jeju-gateway-onboarding-complete'

function getStoredNotificationSettings(): NotificationSettings {
  const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY)
  if (stored) {
    return JSON.parse(stored) as NotificationSettings
  }
  return {
    transactionUpdates: true,
    priceAlerts: false,
    stakingRewards: true,
    governanceVotes: false,
    securityAlerts: true,
  }
}

function saveNotificationSettings(settings: NotificationSettings) {
  localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(settings))
}

interface NotificationSettings {
  transactionUpdates: boolean
  priceAlerts: boolean
  stakingRewards: boolean
  governanceVotes: boolean
  securityAlerts: boolean
}

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: '48px',
        height: '28px',
        borderRadius: '14px',
        background: checked ? 'var(--accent-primary)' : 'var(--surface-active)',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        transition: 'background 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: 'white',
          position: 'absolute',
          top: '3px',
          left: checked ? '23px' : '3px',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  )
}

function SettingRow({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: ComponentType<LucideProps>
  title: string
  description?: string
  action?: React.ReactNode
  onClick?: () => void
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Has conditional role/tabIndex for accessibility
    <div
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '1rem',
        background: 'var(--surface-hover)',
        borderRadius: 'var(--radius-md)',
        marginBottom: '0.75rem',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = 'var(--surface-active)'
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.background = 'var(--surface-hover)'
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={20} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
            fontSize: '0.9375rem',
          }}
        >
          {title}
        </p>
        {description && (
          <p
            style={{
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              margin: '0.25rem 0 0',
            }}
          >
            {description}
          </p>
        )}
      </div>
      {action}
      {onClick && !action && (
        <ChevronRightIcon size={20} style={{ color: 'var(--text-muted)' }} />
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const [notifications, setNotifications] = useState<NotificationSettings>(
    getStoredNotificationSettings,
  )
  const [selectedNetwork, setSelectedNetwork] = useState('jeju-testnet')
  const [showNetworkSelector, setShowNetworkSelector] = useState(false)

  const handleNotificationChange = (
    key: keyof NotificationSettings,
    value: boolean,
  ) => {
    const newSettings = { ...notifications, [key]: value }
    setNotifications(newSettings)
    saveNotificationSettings(newSettings)
  }

  const handleResetOnboarding = () => {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    window.location.reload()
  }

  const currentNetwork = NETWORKS.find((n) => n.id === selectedNetwork)

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--gradient-brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SettingsIcon size={24} style={{ color: 'white' }} />
        </div>
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            Settings
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Customize your Gateway experience
          </p>
        </div>
      </div>

      {/* Appearance */}
      <div className="card">
        <h2
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {theme === 'dark' ? (
            <MoonIcon size={20} style={{ color: 'var(--accent-primary)' }} />
          ) : (
            <SunIcon size={20} style={{ color: 'var(--accent-primary)' }} />
          )}
          Appearance
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <button
            type="button"
            onClick={() => setTheme('light')}
            style={{
              padding: '1.25rem 1rem',
              background:
                theme === 'light'
                  ? 'var(--accent-primary-soft)'
                  : 'var(--surface-hover)',
              border:
                theme === 'light'
                  ? '2px solid var(--accent-primary)'
                  : '2px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s',
            }}
          >
            <SunIcon
              size={28}
              style={{
                color:
                  theme === 'light'
                    ? 'var(--accent-primary)'
                    : 'var(--text-muted)',
                marginBottom: '0.5rem',
              }}
            />
            <p
              style={{
                fontWeight: 600,
                color:
                  theme === 'light'
                    ? 'var(--accent-primary)'
                    : 'var(--text-secondary)',
                margin: 0,
              }}
            >
              Light
            </p>
          </button>

          <button
            type="button"
            onClick={() => setTheme('dark')}
            style={{
              padding: '1.25rem 1rem',
              background:
                theme === 'dark'
                  ? 'var(--accent-primary-soft)'
                  : 'var(--surface-hover)',
              border:
                theme === 'dark'
                  ? '2px solid var(--accent-primary)'
                  : '2px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s',
            }}
          >
            <MoonIcon
              size={28}
              style={{
                color:
                  theme === 'dark'
                    ? 'var(--accent-primary)'
                    : 'var(--text-muted)',
                marginBottom: '0.5rem',
              }}
            />
            <p
              style={{
                fontWeight: 600,
                color:
                  theme === 'dark'
                    ? 'var(--accent-primary)'
                    : 'var(--text-secondary)',
                margin: 0,
              }}
            >
              Dark
            </p>
          </button>
        </div>
      </div>

      {/* Network */}
      <div className="card">
        <h2
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <GlobeIcon size={20} style={{ color: 'var(--accent-primary)' }} />
          Network
        </h2>

        <SettingRow
          icon={GlobeIcon}
          title={currentNetwork?.name ?? 'Select Network'}
          description={
            currentNetwork?.isTestnet ? 'Testnet' : 'Production Network'
          }
          onClick={() => setShowNetworkSelector(!showNetworkSelector)}
          action={
            <span style={{ fontSize: '1.5rem' }}>{currentNetwork?.icon}</span>
          }
        />

        {showNetworkSelector && (
          <div
            style={{
              padding: '0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              marginTop: '-0.5rem',
              marginBottom: '0.75rem',
            }}
          >
            {NETWORKS.map((network) => (
              <button
                key={network.id}
                type="button"
                onClick={() => {
                  setSelectedNetwork(network.id)
                  setShowNetworkSelector(false)
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  background:
                    selectedNetwork === network.id
                      ? 'var(--accent-primary-soft)'
                      : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>{network.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, margin: 0 }}>{network.name}</p>
                  <p
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      margin: 0,
                    }}
                  >
                    Chain ID: {network.chainId}
                  </p>
                </div>
                {selectedNetwork === network.id && (
                  <CheckIcon
                    size={18}
                    style={{ color: 'var(--accent-primary)' }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="card">
        <h2
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <BellIcon size={20} style={{ color: 'var(--accent-primary)' }} />
          Notifications
        </h2>

        <SettingRow
          icon={InfoIcon}
          title="Transaction Updates"
          description="Get notified when transactions complete"
          action={
            <ToggleSwitch
              checked={notifications.transactionUpdates}
              onChange={(v) =>
                handleNotificationChange('transactionUpdates', v)
              }
            />
          }
        />

        <SettingRow
          icon={InfoIcon}
          title="Staking Rewards"
          description="Alerts for staking rewards and unbonding"
          action={
            <ToggleSwitch
              checked={notifications.stakingRewards}
              onChange={(v) => handleNotificationChange('stakingRewards', v)}
            />
          }
        />

        <SettingRow
          icon={ShieldIcon}
          title="Security Alerts"
          description="Important security notifications"
          action={
            <ToggleSwitch
              checked={notifications.securityAlerts}
              onChange={(v) => handleNotificationChange('securityAlerts', v)}
            />
          }
        />

        <SettingRow
          icon={InfoIcon}
          title="Price Alerts"
          description="Token price movement notifications"
          action={
            <ToggleSwitch
              checked={notifications.priceAlerts}
              onChange={(v) => handleNotificationChange('priceAlerts', v)}
            />
          }
        />
      </div>

      {/* Help & Support */}
      <div className="card">
        <h2
          style={{
            fontSize: '1.125rem',
            fontWeight: 600,
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <HelpCircleIcon
            size={20}
            style={{ color: 'var(--accent-primary)' }}
          />
          Help & Support
        </h2>

        <SettingRow
          icon={RotateCcwIcon}
          title="Restart Onboarding"
          description="View the welcome tour again"
          onClick={handleResetOnboarding}
        />

        <SettingRow
          icon={BookOpenIcon}
          title="Documentation"
          description="Learn about Jeju Gateway features"
          onClick={() => window.open('https://docs.jeju.network', '_blank')}
        />
      </div>

      {/* Version info */}
      <div
        style={{
          textAlign: 'center',
          padding: '1.5rem',
          color: 'var(--text-muted)',
          fontSize: '0.8125rem',
        }}
      >
        <p style={{ margin: 0 }}>Jeju Gateway v1.0.0</p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>
          © 2025 Jeju Network
        </p>
      </div>
    </div>
  )
}
