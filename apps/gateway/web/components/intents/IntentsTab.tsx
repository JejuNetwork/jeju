import {
  Activity,
  BarChart3,
  type LucideProps,
  Route,
  Users,
  Zap,
} from 'lucide-react'
import { type ComponentType, useState } from 'react'
import { useAccount } from 'wagmi'
import { useOIFStats } from '../../hooks/useIntentAPI'
import { CreateIntentModal } from './CreateIntentModal'
import { IntentsView } from './IntentsView'
import { RoutesView } from './RoutesView'
import { SolversView } from './SolversView'
import { StatsView } from './StatsView'

const ZapIcon = Zap as ComponentType<LucideProps>
const ActivityIcon = Activity as ComponentType<LucideProps>
const RouteIcon = Route as ComponentType<LucideProps>
const UsersIcon = Users as ComponentType<LucideProps>
const BarChart3Icon = BarChart3 as ComponentType<LucideProps>

type View = 'intents' | 'routes' | 'solvers' | 'stats'

export function IntentsTab() {
  const [activeView, setActiveView] = useState<View>('intents')
  const [showCreate, setShowCreate] = useState(false)
  const { data: stats } = useOIFStats()
  const { isConnected } = useAccount()

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
            <ZapIcon size={22} color="white" />
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
              Intent Explorer
            </h2>
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-secondary)',
                margin: '2px 0 0',
              }}
            >
              Open Intents Framework
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div
            className="hide-mobile"
            style={{ display: 'flex', gap: '1.25rem' }}
          >
            <Stat label="Intents" value={stats?.totalIntents ?? 0} />
            <Stat
              label="Solvers"
              value={stats?.activeSolvers ?? stats?.totalSolvers ?? 0}
            />
            <Stat
              label="Success"
              value={`${(stats?.successRate ?? 0).toFixed(1)}%`}
            />
          </div>
          <button
            type="button"
            className={`button nav-tab ${isConnected ? '' : 'button-secondary'}`}
            onClick={() => setShowCreate(true)}
            disabled={!isConnected}
          >
            <ZapIcon size={14} />
            Create
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          marginBottom: '1.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.75rem',
          overflowX: 'auto',
        }}
      >
        <Tab
          icon={<ActivityIcon size={14} />}
          label="Intents"
          active={activeView === 'intents'}
          onClick={() => setActiveView('intents')}
        />
        <Tab
          icon={<RouteIcon size={14} />}
          label="Routes"
          active={activeView === 'routes'}
          onClick={() => setActiveView('routes')}
        />
        <Tab
          icon={<UsersIcon size={14} />}
          label="Solvers"
          active={activeView === 'solvers'}
          onClick={() => setActiveView('solvers')}
        />
        <Tab
          icon={<BarChart3Icon size={14} />}
          label="Stats"
          active={activeView === 'stats'}
          onClick={() => setActiveView('stats')}
        />
      </div>

      {activeView === 'intents' && <IntentsView />}
      {activeView === 'routes' && <RoutesView />}
      {activeView === 'solvers' && <SolversView />}
      {activeView === 'stats' && <StatsView />}
      {showCreate && <CreateIntentModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function Tab({
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
      style={{ borderRadius: 'var(--radius-md)', border: 'none' }}
    >
      {icon}
      {label}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: '1rem',
          fontWeight: 700,
          color: 'var(--accent-primary)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '0.625rem',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
    </div>
  )
}
