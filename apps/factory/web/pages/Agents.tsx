/**
 * Agents Page
 *
 * Browse and filter AI agents with responsive design.
 */

import { clsx } from 'clsx'
import { Bot, Plus, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchBar,
  StatsGrid,
} from '../components/shared'
import { type AgentStatus, type AgentType, useAgents } from '../hooks/useAgents'
import { formatCompactNumber } from '../lib/format'

const typeLabels: Record<AgentType, string> = {
  validator: 'Validator',
  compute: 'Compute',
  oracle: 'Oracle',
  assistant: 'Assistant',
}

const statusColors: Record<AgentStatus, string> = {
  active: 'badge-success',
  paused: 'badge-warning',
  offline: 'badge-neutral',
}

const statusLabels: Record<AgentStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  offline: 'Offline',
}

const typeFilters = [
  { value: 'all', label: 'All' },
  { value: 'validator', label: 'Validator' },
  { value: 'compute', label: 'Compute' },
  { value: 'oracle', label: 'Oracle' },
  { value: 'assistant', label: 'Assistant' },
]

const statusFilters = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'offline', label: 'Offline' },
]

export function AgentsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AgentType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all')

  const { agents, isLoading, error } = useAgents({
    type: typeFilter !== 'all' ? typeFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  })

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      if (!search) return true
      return agent.name.toLowerCase().includes(search.toLowerCase())
    })
  }, [agents, search])

  const stats = useMemo(
    () => ({
      total: agents.length,
      active: agents.filter((a) => a.status === 'active').length,
      totalTasks: agents.reduce((sum, a) => sum + a.metrics.tasksCompleted, 0),
      avgReputation:
        agents.length > 0
          ? Math.round(
              agents.reduce((sum, a) => sum + a.metrics.reputation, 0) /
                agents.length,
            )
          : 0,
    }),
    [agents],
  )

  const statsData = useMemo(
    () => [
      {
        label: 'Total Agents',
        value: stats.total.toString(),
        color: 'text-accent-400',
        loading: isLoading,
      },
      {
        label: 'Active',
        value: stats.active.toString(),
        color: 'text-success-400',
        loading: isLoading,
      },
      {
        label: 'Tasks Completed',
        value: formatCompactNumber(stats.totalTasks),
        color: 'text-info-400',
        loading: isLoading,
      },
      {
        label: 'Avg. Reputation',
        value: stats.avgReputation.toString(),
        color: 'text-warning-400',
        loading: isLoading,
      },
    ],
    [stats, isLoading],
  )

  return (
    <div className="page-container">
      <PageHeader
        title="Agents"
        icon={Bot}
        iconColor="text-accent-400"
        action={
          <Link to="/agents/deploy" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Deploy</span> Agent
          </Link>
        }
      />

      <div className="card p-3 sm:p-4 mb-6 animate-in">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search agents..."
            className="flex-1 mb-0 p-0 border-0 bg-transparent shadow-none"
          />

          <fieldset
            className="flex flex-wrap gap-2 border-0"
            aria-label="Agent type filters"
          >
            {typeFilters.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setTypeFilter(type.value as AgentType | 'all')}
                className={clsx(
                  'px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  typeFilter === type.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
                )}
                aria-pressed={typeFilter === type.value}
              >
                {type.label}
              </button>
            ))}
          </fieldset>

          <fieldset
            className="flex flex-wrap gap-2 border-0"
            aria-label="Status filters"
          >
            {statusFilters.map((status) => (
              <button
                key={status.value}
                type="button"
                onClick={() =>
                  setStatusFilter(status.value as AgentStatus | 'all')
                }
                className={clsx(
                  'px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  statusFilter === status.value
                    ? 'bg-factory-500 text-white shadow-glow'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-100 hover:bg-surface-700',
                )}
                aria-pressed={statusFilter === status.value}
              >
                {status.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      <StatsGrid stats={statsData} columns={4} />

      {isLoading ? (
        <LoadingState text="Loading agents..." />
      ) : error ? (
        <ErrorState title="Failed to load agents" />
      ) : filteredAgents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents found"
          description={
            search
              ? 'Try a different search term'
              : 'Deploy an agent to automate tasks'
          }
          actionLabel="Deploy Agent"
          actionHref="/agents/deploy"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent, index) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.id}`}
              className="card p-5 sm:p-6 card-hover block animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-accent-500/15 flex items-center justify-center">
                    <Bot
                      className="w-5 h-5 text-accent-400"
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold text-surface-100">
                      {agent.name}
                    </h3>
                    <p className="text-surface-500 text-sm">
                      {typeLabels[agent.type]}
                    </p>
                  </div>
                </div>
                <span className={clsx('badge', statusColors[agent.status])}>
                  {statusLabels[agent.status]}
                </span>
              </div>

              <p className="text-surface-400 text-sm line-clamp-2 mb-4">
                {agent.description ?? 'No description provided'}
              </p>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-surface-100 font-semibold">
                    {agent.metrics.tasksCompleted}
                  </p>
                  <p className="text-surface-500 text-xs">Tasks</p>
                </div>
                <div>
                  <p className="text-surface-100 font-semibold">
                    {(agent.metrics.successRate * 100).toFixed(0)}%
                  </p>
                  <p className="text-surface-500 text-xs">Success</p>
                </div>
                <div>
                  <p className="text-surface-100 font-semibold">
                    {agent.metrics.reputation}
                  </p>
                  <p className="text-surface-500 text-xs">Rep</p>
                </div>
              </div>

              {agent.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {agent.capabilities.slice(0, 3).map((cap) => (
                    <span
                      key={cap.name}
                      className="text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded flex items-center gap-1"
                    >
                      <Zap className="w-3 h-3" aria-hidden="true" />
                      {cap.name}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
