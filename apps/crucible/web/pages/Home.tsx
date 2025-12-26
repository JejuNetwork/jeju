/**
 * Home Page
 */

import { Link } from 'react-router-dom'
import { useInfo } from '../hooks'

const features = [
  {
    href: '/agents',
    icon: '🤖',
    title: 'Agents',
    description: 'View, create, and manage your AI agents',
  },
  {
    href: '/chat',
    icon: '💬',
    title: 'Chat',
    description: 'Interact with agents and manage rooms',
  },
]

const stats = [
  { label: 'Active Runtimes', key: 'runtimes' as const },
  { label: 'Network', key: 'network' as const },
  { label: 'DWS Available', key: 'dwsAvailable' as const },
]

export default function HomePage() {
  const { data: info, isLoading } = useInfo()

  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <div className="text-center mb-12 pt-8">
        <div className="text-6xl mb-4 animate-float">🔥</div>
        <h1 className="text-5xl md:text-7xl font-bold mb-4">
          <span className="text-gradient">Crucible</span>
        </h1>
        <p
          className="text-lg max-w-xl mx-auto"
          style={{ color: 'var(--text-secondary)' }}
        >
          Decentralized agent orchestration platform for autonomous AI agents
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mb-12">
        {stats.map((stat) => (
          <div key={stat.key} className="card-static p-4 text-center">
            <p
              className="text-sm mb-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {stat.label}
            </p>
            <p
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {isLoading ? (
                <span className="shimmer inline-block w-16 h-7 rounded" />
              ) : !info ? (
                '—'
              ) : stat.key === 'dwsAvailable' ? (
                info.dwsAvailable ? (
                  '✓ Online'
                ) : (
                  '✗ Offline'
                )
              ) : (
                String(info[stat.key])
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-2xl">
        {features.map((feature) => (
          <Link key={feature.href} to={feature.href} className="group">
            <div className="card p-8 h-full">
              <div className="text-5xl mb-4 group-hover:scale-110 transition-transform">
                {feature.icon}
              </div>
              <h3
                className="text-xl font-bold mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                {feature.title}
              </h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                {feature.description}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Start */}
      <div className="mt-12 w-full max-w-3xl">
        <div className="card-static p-6">
          <h2
            className="text-xl font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Quick Start
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center text-sm font-bold"
                style={{ color: 'var(--color-primary)' }}
              >
                1
              </div>
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Create an Agent
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Select a template and deploy your agent
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center text-sm font-bold"
                style={{ color: 'var(--color-primary)' }}
              >
                2
              </div>
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Start Chatting
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Interact with your agents in real-time
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full bg-crucible-primary/20 flex items-center justify-center text-sm font-bold"
                style={{ color: 'var(--color-primary)' }}
              >
                3
              </div>
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Create Rooms
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Multi-agent collaboration and debate
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
