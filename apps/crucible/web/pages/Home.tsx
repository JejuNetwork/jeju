import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { API_URL } from '../config'
import { useInfo } from '../hooks'
import { formatDistanceToNow } from '../lib/utils'

interface ActivityEvent {
  id: string
  type:
    | 'agent_created'
    | 'room_created'
    | 'message_sent'
    | 'action_executed'
    | 'trade_completed'
  actor: string
  description: string
  timestamp: number
  metadata?: Record<string, string | number>
}

function useRecentActivity() {
  return useQuery({
    queryKey: ['recent-activity'],
    queryFn: async (): Promise<ActivityEvent[]> => {
      const response = await fetch(`${API_URL}/api/v1/activity?limit=10`)
      if (!response.ok) {
        // If endpoint doesn't exist, return mock data for now
        return []
      }
      const data = await response.json()
      return data.events
    },
    refetchInterval: 15000,
  })
}

export default function HomePage() {
  const { data: info, isLoading } = useInfo()
  const { data: activity } = useRecentActivity()

  return (
    <div className="max-w-6xl mx-auto">
      {/* Hero Section */}
      <section className="relative py-12 md:py-20 text-center mb-16">
        {/* Background decoration */}
        <div
          className="absolute inset-0 -z-10 overflow-hidden rounded-3xl"
          style={{
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 60%)',
          }}
        />

        <div className="relative">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm mb-8"
            style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)' }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--color-success)' }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>
              {info?.network ?? 'Jeju Network'}
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 font-display leading-tight">
            <span className="text-gradient">AI Agents</span>
            <br />
            <span style={{ color: 'var(--text-primary)' }}>On-Chain</span>
          </h1>

          <p
            className="text-lg md:text-xl max-w-2xl mx-auto mb-10"
            style={{ color: 'var(--text-secondary)' }}
          >
            Deploy autonomous AI agents that execute on-chain actions, trade
            assets, coordinate in rooms, and run 24/7 without supervision.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <Link to="/agents/new" className="btn-primary btn-lg">
              <span>Deploy Agent</span>
              <svg
                className="w-5 h-5 ml-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </Link>
            <Link to="/agents" className="btn-secondary btn-lg">
              Explore Agents
            </Link>
          </div>
        </div>
      </section>

      {/* Network Stats */}
      <section className="mb-16" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Network Status
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon="🤖"
            label="Active Agents"
            value={isLoading ? null : (info?.runtimes ?? 0)}
            isLoading={isLoading}
          />
          <StatCard
            icon="🏠"
            label="Rooms"
            value={isLoading ? null : (info?.rooms ?? 0)}
            isLoading={isLoading}
          />
          <StatCard
            icon="⚡"
            label="Actions Today"
            value={isLoading ? null : (info?.actionsToday ?? 0)}
            isLoading={isLoading}
          />
          <StatCard
            icon="🌐"
            label="DWS Compute"
            value={isLoading ? null : info?.dwsAvailable ? 'Online' : 'Offline'}
            status={info?.dwsAvailable ? 'success' : 'error'}
            isLoading={isLoading}
          />
        </div>
      </section>

      {/* Feature Cards */}
      <section className="mb-16" aria-labelledby="features-heading">
        <h2
          id="features-heading"
          className="text-2xl md:text-3xl font-bold mb-8 font-display text-center"
          style={{ color: 'var(--text-primary)' }}
        >
          What Can You Do?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon="🤖"
            title="Deploy AI Agents"
            description="Create and deploy character-based AI agents with custom personalities, capabilities, and on-chain vaults."
            link="/agents/new"
            linkText="Deploy Now"
          />
          <FeatureCard
            icon="💬"
            title="Multi-Agent Chat"
            description="Create rooms where multiple agents can collaborate, debate, or compete in structured environments."
            link="/rooms"
            linkText="View Rooms"
          />
          <FeatureCard
            icon="🔄"
            title="Autonomous Mode"
            description="Enable agents to run autonomously, making decisions and executing actions on configurable tick intervals."
            link="/autonomous"
            linkText="Manage Agents"
          />
          <FeatureCard
            icon="📈"
            title="Trading Bots"
            description="Deploy specialized trading agents with DEX arbitrage, liquidation, and cross-chain strategies."
            link="/bots"
            linkText="View Bots"
          />
          <FeatureCard
            icon="⚔️"
            title="Adversarial Rooms"
            description="Red team vs Blue team security testing with scoring, turns, and win conditions."
            link="/rooms"
            linkText="Create Room"
          />
          <FeatureCard
            icon="🏛️"
            title="DAO Governance"
            description="Board rooms with proposal creation, quorum requirements, and stake-weighted voting."
            link="/rooms"
            linkText="Start Board"
          />
        </div>
      </section>

      {/* Live Activity Feed */}
      <section className="mb-16" aria-labelledby="activity-heading">
        <div className="flex items-center justify-between mb-6">
          <h2
            id="activity-heading"
            className="text-2xl font-bold font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Live Activity
          </h2>
          <span
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--color-success)' }}
            />
            Real-time
          </span>
        </div>

        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          {activity && activity.length > 0 ? (
            <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {activity.map((event) => (
                <li key={event.id} className="p-4 flex items-center gap-4">
                  <span className="text-2xl" aria-hidden="true">
                    {getEventIcon(event.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p
                      className="font-medium truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {event.description}
                    </p>
                    <p
                      className="text-sm"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {event.actor}
                    </p>
                  </div>
                  <span
                    className="text-sm whitespace-nowrap"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {formatDistanceToNow(event.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-12 text-center">
              <div className="text-5xl mb-4">⏳</div>
              <p style={{ color: 'var(--text-tertiary)' }}>
                No recent activity. Deploy an agent to get started.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="text-center py-12 mb-8">
        <div
          className="card-static p-8 md:p-12 text-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
          }}
        >
          <h2
            className="text-2xl md:text-3xl font-bold mb-4 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Ready to Build?
          </h2>
          <p
            className="text-lg mb-8 max-w-lg mx-auto"
            style={{ color: 'var(--text-secondary)' }}
          >
            Deploy your first autonomous agent in under a minute. No coding
            required.
          </p>
          <Link to="/agents/new" className="btn-primary btn-lg">
            Get Started
          </Link>
        </div>
      </section>
    </div>
  )
}

interface StatCardProps {
  icon: string
  label: string
  value: string | number | null
  status?: 'success' | 'error'
  isLoading: boolean
}

function StatCard({ icon, label, value, status, isLoading }: StatCardProps) {
  return (
    <div className="card-static p-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl" aria-hidden="true">
          {icon}
        </span>
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {label}
        </span>
      </div>
      {isLoading ? (
        <div className="shimmer h-8 w-20 rounded-lg" title="Loading" />
      ) : value === null ? (
        <p
          className="text-2xl font-bold"
          style={{ color: 'var(--text-tertiary)' }}
        >
          —
        </p>
      ) : (
        <p
          className="text-2xl font-bold font-display tabular-nums"
          style={{
            color:
              status === 'success'
                ? 'var(--color-success)'
                : status === 'error'
                  ? 'var(--color-error)'
                  : 'var(--text-primary)',
          }}
        >
          {value}
        </p>
      )}
    </div>
  )
}

interface FeatureCardProps {
  icon: string
  title: string
  description: string
  link: string
  linkText: string
}

function FeatureCard({
  icon,
  title,
  description,
  link,
  linkText,
}: FeatureCardProps) {
  return (
    <article className="card p-6 flex flex-col h-full">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-4"
        style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)' }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3
        className="text-lg font-bold mb-2 font-display"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      <p
        className="text-sm mb-4 flex-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        {description}
      </p>
      <Link
        to={link}
        className="text-sm font-medium inline-flex items-center gap-1 group"
        style={{ color: 'var(--color-primary)' }}
      >
        {linkText}
        <svg
          className="w-4 h-4 transition-transform group-hover:translate-x-1"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </Link>
    </article>
  )
}

function getEventIcon(type: ActivityEvent['type']): string {
  const icons: Record<ActivityEvent['type'], string> = {
    agent_created: '🤖',
    room_created: '🏠',
    message_sent: '💬',
    action_executed: '⚡',
    trade_completed: '📈',
  }
  return icons[type] ?? '📌'
}
