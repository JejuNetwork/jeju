import {
  Activity,
  Bot,
  ChevronRight,
  Crown,
  Edit2,
  MessageSquare,
  Shield,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentRole, DAOAgent, DAODetail } from '../../types/dao'
import { AgentDetailModal } from './AgentDetailModal'

interface AgentsTabProps {
  dao: DAODetail
}

const ROLE_ICONS: Record<AgentRole, typeof Crown> = {
  CEO: Crown,
  TREASURY: Shield,
  CODE: Bot,
  COMMUNITY: MessageSquare,
  SECURITY: Shield,
  LEGAL: Shield,
  CUSTOM: Bot,
}

const ROLE_GRADIENTS: Record<AgentRole, string> = {
  CEO: 'var(--gradient-accent)',
  TREASURY: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
  CODE: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
  COMMUNITY: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
  SECURITY: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
  LEGAL: 'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)',
  CUSTOM: 'var(--gradient-secondary)',
}

interface AgentCardProps {
  agent: DAOAgent
  isCEO?: boolean
  onViewDetails: (agent: DAOAgent) => void
}

function AgentCard({ agent, isCEO = false, onViewDetails }: AgentCardProps) {
  const Icon = ROLE_ICONS[agent.role]
  const gradientBg = ROLE_GRADIENTS[agent.role]
  const activeConnectors = agent.connectors.filter((c) => c.enabled).length

  const timeSinceActive = Date.now() - agent.lastActiveAt
  const isRecentlyActive = timeSinceActive < 3600000 // 1 hour

  return (
    <div
      className="group relative rounded-2xl p-5 transition-all duration-300"
      style={{
        backgroundColor: 'var(--surface)',
        border: isCEO
          ? '2px solid var(--color-accent)'
          : '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Status indicator */}
      {agent.isActive && (
        <div
          className="absolute top-4 right-4 w-2.5 h-2.5 rounded-full"
          style={{
            backgroundColor: isRecentlyActive
              ? 'var(--color-success)'
              : 'var(--text-tertiary)',
            animation: isRecentlyActive ? 'pulse 2s infinite' : 'none',
          }}
          title={isRecentlyActive ? 'Recently active' : 'Active'}
        />
      )}

      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div
          className="shrink-0 w-14 h-14 rounded-xl flex items-center justify-center shadow-lg"
          style={{ background: gradientBg }}
        >
          <Icon className="w-6 h-6 text-white" aria-hidden="true" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3
              className="font-semibold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {agent.persona.name}
            </h3>
            {isCEO && (
              <span
                className="px-2 py-0.5 text-xs font-semibold rounded-full"
                style={{
                  backgroundColor: 'rgba(255, 107, 107, 0.15)',
                  color: 'var(--color-accent)',
                }}
              >
                CEO
              </span>
            )}
          </div>
          <p className="text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>
            {agent.role}
          </p>
          <p
            className="text-sm line-clamp-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {agent.persona.bio}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <div
          className="flex items-center gap-1.5"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Bot className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{agent.modelName}</span>
        </div>
        <div
          className="flex items-center gap-1.5"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{agent.decisionsCount} decisions</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor:
                agent.approvalRate >= 70
                  ? 'var(--color-success)'
                  : agent.approvalRate >= 50
                    ? 'var(--color-warning)'
                    : 'var(--color-error)',
            }}
            aria-hidden="true"
          />
          <span style={{ color: 'var(--text-secondary)' }}>
            {agent.approvalRate}% approval
          </span>
        </div>
        {activeConnectors > 0 && (
          <div
            className="flex items-center gap-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Zap className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{activeConnectors} connectors</span>
          </div>
        )}
      </div>

      {/* Traits */}
      {agent.persona.traits.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.persona.traits.slice(0, 3).map((trait) => (
            <span
              key={trait}
              className="px-2 py-0.5 text-xs rounded-md"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-tertiary)',
              }}
            >
              {trait}
            </span>
          ))}
          {agent.persona.traits.length > 3 && (
            <span
              className="px-2 py-0.5 text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              +{agent.persona.traits.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onViewDetails(agent)}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
          }}
        >
          View Details
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
        <Link
          to={`/dao/${agent.daoId}/agents/${agent.id}/edit`}
          className="inline-flex items-center justify-center px-3 py-2 rounded-xl transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
          }}
          aria-label="Edit agent"
        >
          <Edit2 className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

function OrgChart({ dao }: { dao: DAODetail }) {
  return (
    <div className="mb-8">
      <h3
        className="text-sm font-medium uppercase tracking-wider mb-4"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Organization Structure
      </h3>
      <div className="relative">
        {/* CEO at top */}
        <div className="flex justify-center mb-8">
          <div
            className="w-32 h-32 rounded-2xl flex flex-col items-center justify-center text-white shadow-xl"
            style={{ background: 'var(--gradient-accent)' }}
          >
            <Crown className="w-8 h-8 mb-2" aria-hidden="true" />
            <span className="font-semibold">{dao.ceo.persona.name}</span>
            <span className="text-xs opacity-75">CEO</span>
          </div>
        </div>

        {/* Connecting line */}
        <div
          className="absolute left-1/2 top-32 w-px h-8"
          style={{
            background:
              'linear-gradient(to bottom, var(--color-accent), transparent)',
          }}
          aria-hidden="true"
        />

        {/* Board members */}
        <div className="flex justify-center gap-4 flex-wrap">
          {dao.board.map((agent) => {
            const Icon = ROLE_ICONS[agent.role]
            const gradient = ROLE_GRADIENTS[agent.role]
            return (
              <div
                key={agent.id}
                className="w-24 h-24 rounded-xl flex flex-col items-center justify-center text-white shadow-lg"
                style={{ background: gradient }}
              >
                <Icon className="w-5 h-5 mb-1" aria-hidden="true" />
                <span className="text-xs font-medium text-center px-1 truncate w-full">
                  {agent.persona.name}
                </span>
                <span className="text-[10px] opacity-75">{agent.role}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function AgentsTab({ dao }: AgentsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<DAOAgent | null>(null)

  const handleViewDetails = useCallback((agent: DAOAgent) => {
    setSelectedAgent(agent)
  }, [])

  const handleCloseModal = useCallback(() => {
    setSelectedAgent(null)
  }, [])

  return (
    <div>
      {/* Org Chart */}
      <OrgChart dao={dao} />

      {/* CEO Section */}
      <div className="mb-8">
        <h3
          className="text-sm font-medium uppercase tracking-wider mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Chief Executive Officer
        </h3>
        <AgentCard agent={dao.ceo} isCEO onViewDetails={handleViewDetails} />
      </div>

      {/* Board Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-sm font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Board of Directors ({dao.board.length} members)
          </h3>
          <Link
            to={`/dao/${dao.daoId}/agents/add`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <Bot className="w-4 h-4" aria-hidden="true" />
            Add Board Member
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {dao.board.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onViewDetails={handleViewDetails}
            />
          ))}
        </div>
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModal agent={selectedAgent} onClose={handleCloseModal} />
      )}
    </div>
  )
}
