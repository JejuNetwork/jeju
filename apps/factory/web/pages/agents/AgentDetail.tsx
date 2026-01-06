import { clsx } from 'clsx'
import {
  Activity,
  ArrowLeft,
  Bot,
  Clock,
  Code,
  ExternalLink,
  Pause,
  Play,
  Settings,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Button, EmptyState, LoadingState } from '../../components/shared'
import {
  type Agent,
  useAgent,
  useDeregisterAgent,
  useUpdateAgent,
} from '../../hooks/useAgents'
import { formatAddress, formatRelativeTime } from '../../lib/format'

type TabType = 'overview' | 'metrics' | 'config' | 'logs'

const typeLabels: Record<string, string> = {
  validator: 'Validator Agent',
  compute: 'Compute Agent',
  oracle: 'Oracle Agent',
  assistant: 'Assistant Agent',
}

const statusColors: Record<string, string> = {
  active: 'badge-success',
  paused: 'badge-warning',
  offline: 'badge-neutral',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  offline: 'Offline',
}

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { address } = useAccount()

  const [activeTab, setActiveTab] = useState<TabType>('overview')

  const { agent, isLoading, error } = useAgent(id ?? '')
  const updateMutation = useUpdateAgent(id ?? '')
  const deregisterMutation = useDeregisterAgent()

  const isOwner = agent && address?.toLowerCase() === agent.owner.toLowerCase()

  const handleTogglePause = async () => {
    if (!agent) return
    const newStatus = agent.status === 'active' ? 'paused' : 'active'
    try {
      await updateMutation.mutateAsync({ status: newStatus })
      toast.success(`Agent ${newStatus === 'active' ? 'resumed' : 'paused'}`)
    } catch {
      toast.error('Failed to update agent status')
    }
  }

  const handleDeregister = async () => {
    if (!agent) return
    if (
      !confirm(
        'Are you sure you want to deregister this agent? This action cannot be undone.',
      )
    ) {
      return
    }
    try {
      await deregisterMutation.mutateAsync(agent.id)
      toast.success('Agent deregistered')
    } catch {
      toast.error('Failed to deregister agent')
    }
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <LoadingState text="Loading agent..." />
      </div>
    )
  }

  if (error || !agent) {
    return (
      <div className="page-container">
        <Link
          to="/agents"
          className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Agents
        </Link>
        <EmptyState
          icon={Bot}
          title="Agent not found"
          description="The agent you're looking for doesn't exist or has been deregistered."
          actionLabel="Browse Agents"
          actionHref="/agents"
        />
      </div>
    )
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Bot },
    { id: 'metrics' as const, label: 'Metrics', icon: Activity },
    { id: 'config' as const, label: 'Configuration', icon: Settings },
    { id: 'logs' as const, label: 'Logs', icon: Terminal },
  ]

  return (
    <div className="page-container">
      {/* Back link */}
      <Link
        to="/agents"
        className="inline-flex items-center gap-2 text-surface-400 hover:text-surface-100 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Agents
      </Link>

      {/* Header */}
      <div className="card p-6 mb-6 animate-in">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-accent-500/15 flex items-center justify-center flex-shrink-0">
              <Bot className="w-7 h-7 text-accent-400" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-surface-100 font-display">
                  {agent.name}
                </h1>
                <span className={clsx('badge', statusColors[agent.status])}>
                  {statusLabels[agent.status]}
                </span>
              </div>
              <p className="text-surface-400 mb-3">
                {typeLabels[agent.type] ?? agent.type}
              </p>
              <p className="text-surface-500 text-sm">
                {agent.description || 'No description provided'}
              </p>
            </div>
          </div>

          {/* Actions */}
          {isOwner && (
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                icon={agent.status === 'active' ? Pause : Play}
                onClick={handleTogglePause}
                loading={updateMutation.isPending}
              >
                {agent.status === 'active' ? 'Pause' : 'Resume'}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeregister}
                loading={deregisterMutation.isPending}
              >
                Deregister
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-surface-800/50 mb-6">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'text-factory-400 border-factory-400'
                : 'text-surface-400 border-transparent hover:text-surface-100 hover:border-surface-600',
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab agent={agent} />}

      {activeTab === 'metrics' && <MetricsTab metrics={agent.metrics} />}

      {activeTab === 'config' && <ConfigTab agent={agent} />}

      {activeTab === 'logs' && <LogsTab />}
    </div>
  )
}

interface OverviewTabProps {
  agent: Agent
}

function OverviewTab({ agent }: OverviewTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Agent Info */}
      <div className="card p-6 animate-in">
        <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Bot className="w-4 h-4 text-surface-400" />
          Agent Details
        </h3>
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-surface-500">ID</dt>
            <dd className="text-surface-200 font-mono text-sm">{agent.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Address</dt>
            <dd className="text-surface-200 font-mono text-sm">
              {formatAddress(agent.address, 6)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Owner</dt>
            <dd className="text-surface-200 font-mono text-sm">
              {formatAddress(agent.owner, 6)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Created</dt>
            <dd className="text-surface-200">
              {formatRelativeTime(agent.createdAt)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-surface-500">Last Seen</dt>
            <dd className="text-surface-200">
              {formatRelativeTime(agent.lastSeen)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Capabilities */}
      <div className="card p-6 animate-in" style={{ animationDelay: '50ms' }}>
        <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-surface-400" />
          Capabilities
        </h3>
        {agent.capabilities.length === 0 ? (
          <p className="text-surface-500">No capabilities registered.</p>
        ) : (
          <div className="space-y-3">
            {agent.capabilities.map((cap) => (
              <div key={cap.name} className="p-3 bg-surface-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-surface-200 font-medium">
                    {cap.name}
                  </span>
                  <span className="text-xs text-surface-500">
                    v{cap.version}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Endpoints */}
      <div
        className="card p-6 animate-in lg:col-span-2"
        style={{ animationDelay: '100ms' }}
      >
        <h3 className="font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Code className="w-4 h-4 text-surface-400" />
          Endpoints
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-surface-800/50 rounded-lg">
            <p className="text-sm text-surface-500 mb-1">A2A Endpoint</p>
            {agent.a2aEndpoint ? (
              <a
                href={agent.a2aEndpoint}
                target="_blank"
                rel="noopener noreferrer"
                className="text-factory-400 hover:text-factory-300 flex items-center gap-2"
              >
                {agent.a2aEndpoint}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <p className="text-surface-400">Not configured</p>
            )}
          </div>
          <div className="p-4 bg-surface-800/50 rounded-lg">
            <p className="text-sm text-surface-500 mb-1">MCP Endpoint</p>
            {agent.mcpEndpoint ? (
              <a
                href={agent.mcpEndpoint}
                target="_blank"
                rel="noopener noreferrer"
                className="text-factory-400 hover:text-factory-300 flex items-center gap-2"
              >
                {agent.mcpEndpoint}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <p className="text-surface-400">Not configured</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface MetricsTabProps {
  metrics: {
    tasksCompleted: number
    successRate: number
    avgResponseTime: number
    reputation: number
    uptime: number
  }
}

function MetricsTab({ metrics }: MetricsTabProps) {
  const metricItems = [
    {
      label: 'Tasks Completed',
      value: metrics.tasksCompleted.toString(),
      icon: Activity,
      color: 'text-info-400',
    },
    {
      label: 'Success Rate',
      value: `${(metrics.successRate * 100).toFixed(1)}%`,
      icon: Shield,
      color: 'text-success-400',
    },
    {
      label: 'Avg Response Time',
      value: `${metrics.avgResponseTime}ms`,
      icon: Clock,
      color: 'text-warning-400',
    },
    {
      label: 'Reputation',
      value: metrics.reputation.toString(),
      icon: Bot,
      color: 'text-accent-400',
    },
    {
      label: 'Uptime',
      value: `${metrics.uptime.toFixed(1)}%`,
      icon: Activity,
      color: 'text-success-400',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {metricItems.map((item, idx) => (
        <div
          key={item.label}
          className="card p-6 animate-in"
          style={{ animationDelay: `${idx * 50}ms` }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-surface-800">
              <item.icon className={clsx('w-5 h-5', item.color)} />
            </div>
            <span className="text-surface-500">{item.label}</span>
          </div>
          <p className="text-3xl font-bold text-surface-100 font-display">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  )
}

interface ConfigTabProps {
  agent: Agent
}

function ConfigTab({ agent }: ConfigTabProps) {
  return (
    <div className="card p-6 animate-in max-w-2xl">
      <h3 className="text-lg font-semibold text-surface-100 mb-6">
        Agent Configuration
      </h3>
      <div className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium text-surface-200 mb-2">
            Agent Name
          </span>
          <input
            type="text"
            value={agent.name}
            readOnly
            className="input w-full"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-surface-200 mb-2">
            Type
          </span>
          <select value={agent.type} className="input w-full" disabled>
            <option value="validator">Validator</option>
            <option value="compute">Compute</option>
            <option value="oracle">Oracle</option>
            <option value="assistant">Assistant</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-surface-200 mb-2">
            Description
          </span>
          <textarea
            value={agent.description}
            readOnly
            className="input w-full resize-none"
            rows={3}
          />
        </label>
        <p className="text-sm text-surface-500 pt-4">
          Configuration is read-only. Use the CLI to update agent settings.
        </p>
      </div>
    </div>
  )
}

function LogsTab() {
  return (
    <div className="card overflow-hidden animate-in">
      <div className="px-4 py-3 bg-surface-800/50 border-b border-surface-800/50 flex items-center justify-between">
        <h4 className="font-medium text-surface-200">Agent Logs</h4>
        <span className="text-xs text-surface-500 uppercase tracking-wider">
          Last 24h
        </span>
      </div>
      <div className="p-4 font-mono text-sm bg-surface-950/50">
        <div className="space-y-1 text-surface-400">
          <p>
            <span className="text-surface-600">
              [{new Date().toISOString()}]
            </span>{' '}
            Agent initialized
          </p>
          <p>
            <span className="text-surface-600">
              [{new Date().toISOString()}]
            </span>{' '}
            Connected to network
          </p>
          <p>
            <span className="text-surface-600">
              [{new Date().toISOString()}]
            </span>{' '}
            Awaiting tasks...
          </p>
        </div>
      </div>
    </div>
  )
}
