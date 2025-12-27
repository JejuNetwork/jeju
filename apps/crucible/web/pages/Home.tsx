/**
 * Home Page
 *
 * Landing page with hero, stats, feature cards, and quick start guide
 */

import { Link } from 'react-router-dom'
import { useInfo } from '../hooks'
import { FEATURE_CARDS, QUICK_START_STEPS } from '../lib/constants'

export default function HomePage() {
  const { data: info, isLoading } = useInfo()

  return (
    <div className="flex flex-col items-center">
      {/* Hero Section */}
      <section className="text-center mb-16 pt-4 md:pt-8">
        <div className="text-6xl md:text-7xl mb-6 animate-float" role="img" aria-label="Fire emoji">
          🔥
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 font-display">
          <span className="text-gradient">Crucible</span>
        </h1>
        <p
          className="text-lg md:text-xl max-w-2xl mx-auto mb-8 text-balance"
          style={{ color: 'var(--text-secondary)' }}
        >
          Run AI agents on decentralized infrastructure. On-chain registration, 
          DWS compute, and CovenantSQL persistence — no centralized dependencies.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link to="/agents/new" className="btn-primary btn-lg">
            Deploy Agent
          </Link>
          <Link to="/chat" className="btn-secondary btn-lg">
            Open Chat
          </Link>
        </div>
      </section>

      {/* Stats Section */}
      <section className="w-full max-w-4xl mb-16" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Network Status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 stagger-children">
          <StatCard
            label="Active Runtimes"
            value={isLoading ? null : info?.runtimes}
            isLoading={isLoading}
          />
          <StatCard
            label="Network"
            value={isLoading ? null : info?.network}
            isLoading={isLoading}
          />
          <StatCard
            label="DWS Compute"
            value={isLoading ? null : info?.dwsAvailable ? 'Available' : 'Unavailable'}
            status={info?.dwsAvailable ? 'success' : 'error'}
            isLoading={isLoading}
          />
        </div>
      </section>

      {/* Feature Grid */}
      <section className="w-full max-w-3xl mb-16" aria-labelledby="features-heading">
        <h2 id="features-heading" className="sr-only">
          Features
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 stagger-children">
          {FEATURE_CARDS.map((feature) => (
            <Link key={feature.href} to={feature.href} className="group block">
              <article className="card p-8 h-full">
                <div
                  className="text-5xl mb-5 transition-transform duration-300 group-hover:scale-110"
                  role="img"
                  aria-hidden="true"
                >
                  {feature.icon}
                </div>
                <h3
                  className="text-xl font-bold mb-2 font-display"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {feature.title}
                </h3>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {feature.description}
                </p>
                <div
                  className="mt-4 text-sm font-medium flex items-center gap-1 transition-transform group-hover:translate-x-1"
                  style={{ color: 'var(--color-primary)' }}
                >
                  View
                  <span aria-hidden="true">→</span>
                </div>
              </article>
            </Link>
          ))}
        </div>
      </section>

      {/* Quick Start Guide */}
      <section className="w-full max-w-4xl" aria-labelledby="quickstart-heading">
        <div className="card-static p-6 md:p-8">
          <h2
            id="quickstart-heading"
            className="text-2xl font-bold mb-6 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Quick Start
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {QUICK_START_STEPS.map((item) => (
              <div key={item.step} className="flex items-start gap-4">
                <div className="step-circle" aria-hidden="true">
                  {item.step}
                </div>
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-semibold mb-1"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {item.title}
                  </h3>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number | null | undefined
  status?: 'success' | 'error'
  isLoading: boolean
}

function StatCard({ label, value, status, isLoading }: StatCardProps) {
  return (
    <div className="card-static p-5 text-center">
      <p
        className="text-sm font-medium mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {label}
      </p>
      {isLoading ? (
        <div className="shimmer h-8 w-20 mx-auto rounded-lg" aria-label="Loading" />
      ) : value === null || value === undefined ? (
        <p
          className="text-2xl font-bold"
          style={{ color: 'var(--text-tertiary)' }}
        >
          —
        </p>
      ) : (
        <p
          className="text-2xl font-bold font-display"
          style={{
            color:
              status === 'success'
                ? 'var(--color-success)'
                : status === 'error'
                  ? 'var(--color-error)'
                  : 'var(--text-primary)',
          }}
        >
          {status && (
            <span className="mr-1" aria-hidden="true">
              {status === 'success' ? '✓' : '✗'}
            </span>
          )}
          {value}
        </p>
      )}
    </div>
  )
}
