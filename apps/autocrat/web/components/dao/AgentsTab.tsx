/**
 * Agents Tab - CEO and Board Management
 *
 * Displays and manages the CEO and board members for a DAO.
 */

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
import { useState } from 'react'
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

const ROLE_COLORS: Record<AgentRole, string> = {
  CEO: 'from-violet-500 to-pink-500',
  TREASURY: 'from-emerald-500 to-teal-500',
  CODE: 'from-blue-500 to-cyan-500',
  COMMUNITY: 'from-orange-500 to-amber-500',
  SECURITY: 'from-red-500 to-rose-500',
  LEGAL: 'from-slate-500 to-slate-400',
  CUSTOM: 'from-indigo-500 to-purple-500',
}

interface AgentCardProps {
  agent: DAOAgent
  isCEO?: boolean
  onViewDetails: (agent: DAOAgent) => void
}

function AgentCard({ agent, isCEO = false, onViewDetails }: AgentCardProps) {
  const Icon = ROLE_ICONS[agent.role]
  const gradientColors = ROLE_COLORS[agent.role]
  const activeConnectors = agent.connectors.filter((c) => c.enabled).length

  const timeSinceActive = Date.now() - agent.lastActiveAt
  const isRecentlyActive = timeSinceActive < 3600000 // 1 hour

  return (
    <div
      className={`group relative bg-slate-900/50 border rounded-2xl p-5 hover:border-violet-500/50 transition-all duration-300 ${
        isCEO ? 'border-violet-500/30' : 'border-slate-700/50'
      }`}
    >
      {/* Status indicator */}
      {agent.isActive && (
        <div
          className={`absolute top-4 right-4 w-2.5 h-2.5 rounded-full ${
            isRecentlyActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
          }`}
          title={isRecentlyActive ? 'Recently active' : 'Active'}
        />
      )}

      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div
          className={`shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br ${gradientColors} flex items-center justify-center shadow-lg`}
        >
          <Icon className="w-6 h-6 text-white" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-slate-100 truncate">
              {agent.persona.name}
            </h3>
            {isCEO && (
              <span className="px-2 py-0.5 text-xs font-medium bg-violet-500/20 text-violet-400 rounded-full">
                CEO
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-2">{agent.role}</p>
          <p className="text-sm text-slate-400 line-clamp-2">
            {agent.persona.bio}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Bot className="w-3.5 h-3.5" />
          <span>{agent.modelName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Activity className="w-3.5 h-3.5" />
          <span>{agent.decisionsCount} decisions</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              agent.approvalRate >= 70
                ? 'bg-emerald-400'
                : agent.approvalRate >= 50
                  ? 'bg-amber-400'
                  : 'bg-red-400'
            }`}
          />
          <span>{agent.approvalRate}% approval</span>
        </div>
        {activeConnectors > 0 && (
          <div className="flex items-center gap-1.5 text-slate-400">
            <Zap className="w-3.5 h-3.5" />
            <span>{activeConnectors} connectors</span>
          </div>
        )}
      </div>

      {/* Traits */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.persona.traits.slice(0, 3).map((trait) => (
          <span
            key={trait}
            className="px-2 py-0.5 text-xs bg-slate-800 text-slate-400 rounded-md"
          >
            {trait}
          </span>
        ))}
        {agent.persona.traits.length > 3 && (
          <span className="px-2 py-0.5 text-xs text-slate-500">
            +{agent.persona.traits.length - 3}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onViewDetails(agent)}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition-colors"
        >
          View Details
          <ChevronRight className="w-4 h-4" />
        </button>
        <Link
          to={`/dao/${agent.daoId}/agents/${agent.id}/edit`}
          className="inline-flex items-center justify-center px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors"
        >
          <Edit2 className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}

function OrgChart({ dao }: { dao: DAODetail }) {
  return (
    <div className="mb-8">
      <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
        Organization Structure
      </h3>
      <div className="relative">
        {/* CEO at top */}
        <div className="flex justify-center mb-8">
          <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex flex-col items-center justify-center text-white shadow-xl shadow-violet-500/30">
            <Crown className="w-8 h-8 mb-2" />
            <span className="font-semibold">{dao.ceo.persona.name}</span>
            <span className="text-xs opacity-75">CEO</span>
          </div>
        </div>

        {/* Connecting line */}
        <div className="absolute left-1/2 top-32 w-px h-8 bg-gradient-to-b from-violet-500/50 to-transparent" />

        {/* Board members */}
        <div className="flex justify-center gap-4 flex-wrap">
          {dao.board.map((agent) => {
            const Icon = ROLE_ICONS[agent.role]
            const colors = ROLE_COLORS[agent.role]
            return (
              <div
                key={agent.id}
                className={`w-24 h-24 rounded-xl bg-gradient-to-br ${colors} flex flex-col items-center justify-center text-white shadow-lg`}
              >
                <Icon className="w-5 h-5 mb-1" />
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

  return (
    <div>
      {/* Org Chart */}
      <OrgChart dao={dao} />

      {/* CEO Section */}
      <div className="mb-8">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Chief Executive Officer
        </h3>
        <AgentCard
          agent={dao.ceo}
          isCEO
          onViewDetails={setSelectedAgent}
        />
      </div>

      {/* Board Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            Board of Directors ({dao.board.length} members)
          </h3>
          <Link
            to={`/dao/${dao.daoId}/agents/add`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors"
          >
            <Bot className="w-4 h-4" />
            Add Board Member
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {dao.board.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onViewDetails={setSelectedAgent}
            />
          ))}
        </div>
      </div>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  )
}
