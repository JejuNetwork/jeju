import {
  ArrowRight,
  CheckCircle,
  Clock,
  RefreshCw,
  Route,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { formatVolume } from '../../lib/types'
import { HealthRing } from '../components/HealthRing'
import { StatCard } from '../components/StatCard'
import { useOIFStats } from '../hooks/useMonitoring'

type Tab = 'overview' | 'solvers' | 'routes'

export function OIFStats() {
  const { stats, solvers, routes, isLoading, error, refetch } = useOIFStats()
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  const avgSuccessRate =
    solvers.length > 0
      ? solvers.reduce((sum, s) => sum + s.successRate, 0) / solvers.length
      : 0

  const tabs: Array<{ id: Tab; label: string; icon: typeof Zap }> = [
    { id: 'overview', label: 'Overview', icon: Zap },
    { id: 'solvers', label: 'Solvers', icon: Users },
    { id: 'routes', label: 'Routes', icon: Route },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold text-gradient">OIF</h1>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex p-1 rounded-xl"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id ? 'text-white' : ''
              }`}
              style={{
                backgroundColor:
                  activeTab === tab.id ? 'var(--color-primary)' : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
              }}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div
          className="card-static p-4 text-center"
          style={{ borderColor: 'var(--color-warning)' }}
        >
          <p style={{ color: 'var(--color-warning)' }}>OIF unavailable</p>
        </div>
      )}

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Intents"
              value={stats?.totalIntents ?? '-'}
              icon={<Zap className="w-6 h-6" />}
              status="info"
              loading={isLoading}
            />
            <StatCard
              label="Solvers"
              value={stats?.activeSolvers ?? '-'}
              icon={<Users className="w-6 h-6" />}
              status="success"
              loading={isLoading}
            />
            <StatCard
              label="Volume"
              value={
                stats?.totalVolumeUsd
                  ? `$${formatVolume(stats.totalVolumeUsd)}`
                  : '-'
              }
              icon={<TrendingUp className="w-6 h-6" />}
              status="success"
              loading={isLoading}
            />
            <StatCard
              label="Routes"
              value={routes.length}
              icon={<Route className="w-6 h-6" />}
              status="info"
              loading={isLoading}
            />
          </div>

          <div className="card-static p-6">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <HealthRing
                percentage={avgSuccessRate}
                size={120}
                strokeWidth={10}
                label="Success Rate"
              />

              <div className="flex-1 w-full grid grid-cols-3 gap-4">
                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div
                    className="text-2xl font-bold"
                    style={{ color: 'var(--color-success)' }}
                  >
                    {solvers.filter((s) => s.successRate >= 95).length}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Healthy
                  </div>
                </div>

                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div
                    className="text-2xl font-bold"
                    style={{ color: 'var(--color-warning)' }}
                  >
                    {
                      solvers.filter(
                        (s) => s.successRate >= 80 && s.successRate < 95,
                      ).length
                    }
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Degraded
                  </div>
                </div>

                <div
                  className="p-4 rounded-xl text-center"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div
                    className="text-2xl font-bold"
                    style={{ color: 'var(--color-error)' }}
                  >
                    {solvers.filter((s) => s.successRate < 80).length}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Unhealthy
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Solvers */}
      {activeTab === 'solvers' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              <div key="skeleton-0" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-1" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-2" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-3" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-4" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
            </div>
          ) : solvers.length === 0 ? (
            <div className="card-static p-8 text-center">
              <p style={{ color: 'var(--text-tertiary)' }}>No solvers</p>
            </div>
          ) : (
            solvers.map((solver) => (
              <SolverCard key={solver.address} solver={solver} />
            ))
          )}
        </div>
      )}

      {/* Routes */}
      {activeTab === 'routes' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              <div key="skeleton-0" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-1" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-2" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-3" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
              <div key="skeleton-4" className="card-static p-4">
                <div className="shimmer h-16 w-full rounded" />
              </div>
            </div>
          ) : routes.length === 0 ? (
            <div className="card-static p-8 text-center">
              <p style={{ color: 'var(--text-tertiary)' }}>No routes</p>
            </div>
          ) : (
            routes.map((route) => (
              <RouteCard key={route.routeId} route={route} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface Solver {
  address: string
  name: string
  successRate: number
  reputation: number
}

function SolverCard({ solver }: { solver: Solver }) {
  const getHealthColor = () => {
    if (solver.successRate >= 95) return 'var(--color-success)'
    if (solver.successRate >= 80) return 'var(--color-warning)'
    return 'var(--color-error)'
  }

  return (
    <div className="card-static p-4">
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>
            {solver.name || 'Unnamed'}
          </h3>
          <p
            className="text-xs font-mono truncate"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {solver.address}
          </p>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <div className="font-bold" style={{ color: getHealthColor() }}>
              {solver.successRate.toFixed(1)}%
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Success
            </div>
          </div>

          <div className="text-right">
            <div className="font-bold" style={{ color: 'var(--color-purple)' }}>
              {solver.reputation}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Rep
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface RouteInfo {
  routeId: string
  source: number
  destination: number
  successRate: number
  avgTime: number
}

function RouteCard({ route }: { route: RouteInfo }) {
  const chains: Record<number, string> = {
    1: 'Ethereum',
    8453: 'Base',
    42161: 'Arbitrum',
    10: 'Optimism',
    137: 'Polygon',
    1337: 'Network',
  }
  const getChain = (id: number) => chains[id] || `${id}`

  return (
    <div className="card-static p-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1">
          <span
            className="font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {getChain(route.source)}
          </span>
          <ArrowRight
            className="w-4 h-4"
            style={{ color: 'var(--color-primary)' }}
          />
          <span
            className="font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {getChain(route.destination)}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <CheckCircle
              className="w-4 h-4"
              style={{
                color:
                  route.successRate >= 95
                    ? 'var(--color-success)'
                    : 'var(--color-warning)',
              }}
            />
            <span style={{ color: 'var(--text-primary)' }}>
              {route.successRate.toFixed(1)}%
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Clock
              className="w-4 h-4"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <span style={{ color: 'var(--text-primary)' }}>
              {route.avgTime.toFixed(1)}s
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
