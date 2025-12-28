import { Link } from 'react-router-dom'
import { useInfo } from '../hooks'

export default function HomePage() {
  const { data: info, isLoading } = useInfo()

  return (
    <div className="flex flex-col items-center">
      {/* Hero */}
      <section className="text-center mb-16 pt-4 md:pt-8">
        <div
          className="text-6xl md:text-7xl mb-6 animate-float"
          aria-hidden="true"
        >
          🔥
        </div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 font-display">
          <span className="text-gradient">Crucible</span>
        </h1>
        <p
          className="text-lg md:text-xl max-w-xl mx-auto mb-8"
          style={{ color: 'var(--text-secondary)' }}
        >
          Decentralized AI agent infrastructure
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

      {/* Stats */}
      <section className="w-full max-w-3xl" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">
          Status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Runtimes"
            value={isLoading ? null : info?.runtimes}
            isLoading={isLoading}
          />
          <StatCard
            label="Network"
            value={isLoading ? null : info?.network}
            isLoading={isLoading}
          />
          <StatCard
            label="DWS"
            value={isLoading ? null : info?.dwsAvailable ? 'Online' : 'Offline'}
            status={info?.dwsAvailable ? 'success' : 'error'}
            isLoading={isLoading}
          />
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
        <div className="shimmer h-8 w-20 mx-auto rounded-lg" title="Loading" />
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
          {value}
        </p>
      )}
    </div>
  )
}
