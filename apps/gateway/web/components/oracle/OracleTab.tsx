import {
  Activity,
  Clock,
  DollarSign,
  type LucideProps,
  Radio,
  TrendingUp,
  Users,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { formatEther } from 'viem'
import {
  useFeedRegistry,
  useOracleNetworkStats,
  useOracleSubscriptions,
} from '../../hooks/useOracleNetwork'
import { FeedsView } from './FeedsView'
import { OperatorsView } from './OperatorsView'
import { SubscriptionsView } from './SubscriptionsView'

const ActivityIcon = Activity as ComponentType<LucideProps>
const TrendingUpIcon = TrendingUp as ComponentType<LucideProps>
const UsersIcon = Users as ComponentType<LucideProps>
const ClockIcon = Clock as ComponentType<LucideProps>
const DollarSignIcon = DollarSign as ComponentType<LucideProps>
const RadioIcon = Radio as ComponentType<LucideProps>

type SubTab = 'feeds' | 'subscriptions' | 'operators'

export function OracleTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('feeds')
  const { totalFeeds, activeFeeds, totalFeesCollected, currentEpoch } =
    useOracleNetworkStats()
  const { activeFeedIds } = useFeedRegistry()
  const { subscriptionIds } = useOracleSubscriptions()

  return (
    <div className="animate-fade-in">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: 44,
              height: 44,
              background: 'var(--gradient-brand)',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-glow)',
            }}
          >
            <RadioIcon size={22} color="white" />
          </div>
          <div>
            <h2
              style={{
                fontSize: 'clamp(1.125rem, 4vw, 1.375rem)',
                fontWeight: 700,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              Oracle Network
            </h2>
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-secondary)',
                margin: '2px 0 0',
              }}
            >
              Decentralized price feeds and data
            </p>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <StatCard
          icon={<ActivityIcon size={16} />}
          label="Active Feeds"
          value={String(activeFeeds)}
          subtext={`of ${totalFeeds ?? 0} total`}
          accent="info"
        />
        <StatCard
          icon={<UsersIcon size={16} />}
          label="Your Subscriptions"
          value={String(subscriptionIds.length)}
          subtext="active subscriptions"
          accent="accent"
        />
        <StatCard
          icon={<DollarSignIcon size={16} />}
          label="Total Fees"
          value={
            totalFeesCollected
              ? `${Number(formatEther(totalFeesCollected)).toFixed(2)} ETH`
              : '0 ETH'
          }
          subtext="collected all-time"
          accent="success"
        />
        <StatCard
          icon={<ClockIcon size={16} />}
          label="Current Epoch"
          value={currentEpoch?.toString() ?? '1'}
          subtext="rewards cycle"
          accent="warning"
        />
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.75rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <TabButton
          icon={<TrendingUpIcon size={14} />}
          label="Price Feeds"
          active={activeSubTab === 'feeds'}
          onClick={() => setActiveSubTab('feeds')}
        />
        <TabButton
          icon={<DollarSignIcon size={14} />}
          label="Subscriptions"
          active={activeSubTab === 'subscriptions'}
          onClick={() => setActiveSubTab('subscriptions')}
        />
        <TabButton
          icon={<UsersIcon size={14} />}
          label="Operators"
          active={activeSubTab === 'operators'}
          onClick={() => setActiveSubTab('operators')}
        />
      </div>

      <div className="animate-fade-in">
        {activeSubTab === 'feeds' && <FeedsView feedIds={activeFeedIds} />}
        {activeSubTab === 'subscriptions' && <SubscriptionsView />}
        {activeSubTab === 'operators' && <OperatorsView />}
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  subtext,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  subtext: string
  accent: 'info' | 'accent' | 'success' | 'warning'
}) {
  const colors = {
    info: 'var(--info)',
    accent: 'var(--accent-primary)',
    success: 'var(--success)',
    warning: 'var(--warning)',
  }

  const bgColors = {
    info: 'var(--info-soft)',
    accent: 'var(--accent-primary-soft)',
    success: 'var(--success-soft)',
    warning: 'var(--warning-soft)',
  }

  return (
    <div
      className="stat-card"
      style={{
        textAlign: 'left',
        padding: '1.25rem',
        borderTop: `3px solid ${colors[accent]}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          color: 'var(--text-secondary)',
          fontSize: '0.8125rem',
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-md)',
            background: bgColors[accent],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors[accent],
          }}
        >
          {icon}
        </span>
        {label}
      </div>
      <div
        style={{
          fontSize: '1.5rem',
          fontWeight: 800,
          color: colors[accent],
          fontFamily: 'var(--font-mono)',
          marginBottom: '0.25rem',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        {subtext}
      </div>
    </div>
  )
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'pill pill-active' : 'pill'}
      style={{
        borderRadius: 'var(--radius-md)',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {label}
    </button>
  )
}

export default OracleTab
