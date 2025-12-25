import { clsx } from 'clsx'
import { Bot, Loader2, Plus, Search, Zap } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type AgentStatus, type AgentType, useAgents } from '../hooks/useAgents'

const typeLabels: Record<AgentType, string> = {
  validator: 'Validator',
  compute: 'Compute',
  oracle: 'Oracle',
  assistant: 'Assistant',
}

const statusColors: Record<AgentStatus, string> = {
  active: 'badge-success',
  paused: 'badge-warning',
  offline: 'bg-factory-700/50 text-factory-300',
}

const statusLabels: Record<AgentStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  offline: 'Offline',
}

export function AgentsPage() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<AgentType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all')

  const { agents, isLoading, error } = useAgents({
    type: typeFilter !== 'all' ? typeFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  })

  const filteredAgents = agents.filter((agent) => {
    if (search && !agent.name.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    return true
  })

  const stats = {
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
  }

  return (
    <div className="min-h-screen p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-factory-100 flex items-center gap-3">
            <Bot className="w-7 h-7 text-pink-400" />
            Agents
          </h1>
          <p className="text-factory-400 mt-1">
            AI agents for automation and coordination
          </p>
        </div>
        <Link to="/agents/deploy" className="btn btn-primary">
          <Plus className="w-4 h-4" />
          Deploy Agent
        </Link>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-factory-500" />
            <input
              type="text"
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            {(
              ['all', 'validator', 'compute', 'oracle', 'assistant'] as const
            ).map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => setTypeFilter(type)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  typeFilter === type
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {type === 'all' ? 'All' : typeLabels[type]}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {(['all', 'active', 'paused', 'offline'] as const).map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setStatusFilter(status)}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  statusFilter === status
                    ? 'bg-accent-600 text-white'
                    : 'bg-factory-800 text-factory-400 hover:text-factory-100',
                )}
              >
                {status === 'all' ? 'All Status' : statusLabels[status]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Total Agents',
            value: stats.total.toString(),
            color: 'text-pink-400',
          },
          {
            label: 'Active',
            value: stats.active.toString(),
            color: 'text-green-400',
          },
          {
            label: 'Tasks Completed',
            value: stats.totalTasks.toLocaleString(),
            color: 'text-blue-400',
          },
          {
            label: 'Avg. Reputation',
            value: stats.avgReputation.toString(),
            color: 'text-amber-400',
          },
        ].map((stat) => (
          <div key={stat.label} className="card p-4 text-center">
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-factory-500" />
            ) : (
              <p className={clsx('text-2xl font-bold', stat.color)}>
                {stat.value}
              </p>
            )}
            <p className="text-factory-500 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
        </div>
      ) : error ? (
        <div className="card p-12 text-center">
          <Bot className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            Failed to load agents
          </h3>
          <p className="text-factory-500">Please try again later</p>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="card p-12 text-center">
          <Bot className="w-12 h-12 mx-auto mb-4 text-factory-600" />
          <h3 className="text-lg font-medium text-factory-300 mb-2">
            No agents found
          </h3>
          <p className="text-factory-500 mb-4">
            {search
              ? 'Try adjusting your search terms'
              : 'Deploy your first agent'}
          </p>
          <Link to="/agents/deploy" className="btn btn-primary">
            Deploy Agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => (
            <Link
              key={agent.id}
              to={`/agents/${agent.id}`}
              className="card p-6 card-hover block"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-factory-800 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-pink-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-factory-100">
                      {agent.name}
                    </h3>
                    <p className="text-factory-500 text-sm">
                      {typeLabels[agent.type]}
                    </p>
                  </div>
                </div>
                <span className={clsx('badge', statusColors[agent.status])}>
                  {statusLabels[agent.status]}
                </span>
              </div>

              <p className="text-factory-400 text-sm line-clamp-2 mb-4">
                {agent.description ?? 'No description provided'}
              </p>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-factory-100 font-medium">
                    {agent.metrics.tasksCompleted}
                  </p>
                  <p className="text-factory-500 text-xs">Tasks</p>
                </div>
                <div>
                  <p className="text-factory-100 font-medium">
                    {(agent.metrics.successRate * 100).toFixed(0)}%
                  </p>
                  <p className="text-factory-500 text-xs">Success</p>
                </div>
                <div>
                  <p className="text-factory-100 font-medium">
                    {agent.metrics.reputation}
                  </p>
                  <p className="text-factory-500 text-xs">Rep</p>
                </div>
              </div>

              {agent.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-4">
                  {agent.capabilities.slice(0, 3).map((cap) => (
                    <span
                      key={cap.name}
                      className="text-xs text-factory-500 bg-factory-800 px-2 py-0.5 rounded flex items-center gap-1"
                    >
                      <Zap className="w-3 h-3" />
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
