/**
 * Agent Detail Modal
 *
 * Full view of an agent's configuration including persona, model, connectors, and values.
 */

import {
  Bot,
  Brain,
  Check,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  Heart,
  MessageSquare,
  Package,
  Settings,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentConnector, ConnectorType, DAOAgent } from '../../types/dao'

interface AgentDetailModalProps {
  agent: DAOAgent
  onClose: () => void
}

const CONNECTOR_ICONS: Record<ConnectorType, typeof MessageSquare> = {
  farcaster: MessageSquare,
  github: GitBranch,
  discord: MessageSquare,
  telegram: MessageSquare,
  twitter: MessageSquare,
}

const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  farcaster: 'Farcaster',
  github: 'GitHub',
  discord: 'Discord',
  telegram: 'Telegram',
  twitter: 'Twitter',
}

function ConnectorCard({ connector }: { connector: AgentConnector }) {
  const Icon = CONNECTOR_ICONS[connector.type]
  const label = CONNECTOR_LABELS[connector.type]

  const statusColors = {
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    disconnected: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
            <Icon className="w-5 h-5 text-slate-300" />
          </div>
          <div>
            <h4 className="font-medium text-slate-200">{label}</h4>
            <p className="text-xs text-slate-500">
              {connector.enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        </div>
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded-full border ${statusColors[connector.status]}`}
        >
          {connector.status}
        </span>
      </div>

      {/* Connector-specific config preview */}
      {connector.type === 'farcaster' && 'channelUrl' in connector.config && (
        <div className="space-y-1 text-xs text-slate-400">
          <p>
            Channel:{' '}
            <span className="text-slate-300">
              {connector.config.channelUrl}
            </span>
          </p>
          <p>
            FID: <span className="text-slate-300">{connector.config.fid}</span>
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {connector.config.autoPost && (
              <span className="px-2 py-0.5 bg-slate-700 rounded">
                Auto-post
              </span>
            )}
            {connector.config.monitorMentions && (
              <span className="px-2 py-0.5 bg-slate-700 rounded">
                Monitor mentions
              </span>
            )}
          </div>
        </div>
      )}

      {connector.type === 'github' && 'repoUrl' in connector.config && (
        <div className="space-y-1 text-xs text-slate-400">
          <p>
            Repo:{' '}
            <span className="text-slate-300">{connector.config.repoUrl}</span>
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {connector.config.autoReviewPRs && (
              <span className="px-2 py-0.5 bg-slate-700 rounded">
                Auto-review PRs
              </span>
            )}
            {connector.config.webhookEnabled && (
              <span className="px-2 py-0.5 bg-slate-700 rounded">Webhook</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof Brain
  children: React.ReactNode
}) {
  return (
    <div className="mb-6">
      <h3 className="flex items-center gap-2 text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
        <Icon className="w-4 h-4" />
        {title}
      </h3>
      {children}
    </div>
  )
}

export function AgentDetailModal({ agent, onClose }: AgentDetailModalProps) {
  const [copied, setCopied] = useState(false)

  const copyAgentId = () => {
    navigator.clipboard.writeText(agent.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatLastActive = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default border-none"
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        aria-label="Close modal"
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between p-6 border-b border-slate-800 bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white">
              <Bot className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-1">
                {agent.persona.name}
              </h2>
              <p className="text-slate-400">{agent.role}</p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={copyAgentId}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {agent.id}
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-slate-800/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">
                {agent.decisionsCount}
              </p>
              <p className="text-xs text-slate-500">Decisions</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">
                {agent.approvalRate}%
              </p>
              <p className="text-xs text-slate-500">Approval Rate</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-white">{agent.weight}</p>
              <p className="text-xs text-slate-500">Weight</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-white">
                {formatLastActive(agent.lastActiveAt)}
              </p>
              <p className="text-xs text-slate-500">Last Active</p>
            </div>
          </div>

          {/* Persona */}
          <Section title="Persona" icon={Brain}>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Bio</p>
                <p className="text-slate-200">{agent.persona.bio}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Personality</p>
                <p className="text-slate-200">{agent.persona.personality}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Voice Style</p>
                <p className="text-slate-200">{agent.persona.voiceStyle}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">Traits</p>
                <div className="flex flex-wrap gap-2">
                  {agent.persona.traits.map((trait) => (
                    <span
                      key={trait}
                      className="px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">Specialties</p>
                <div className="flex flex-wrap gap-2">
                  {agent.persona.specialties.map((specialty) => (
                    <span
                      key={specialty}
                      className="px-3 py-1 bg-violet-500/20 text-violet-300 rounded-lg text-sm"
                    >
                      {specialty}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* Model */}
          <Section title="AI Model" icon={Bot}>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-slate-200">
                    {agent.modelName}
                  </h4>
                  <p className="text-sm text-slate-500">
                    {agent.modelProvider}
                  </p>
                </div>
                <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm">
                  Active
                </span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span>ID: {agent.modelId}</span>
                <span>•</span>
                <span>Decision Style: {agent.decisionStyle}</span>
              </div>
            </div>
          </Section>

          {/* Values */}
          <Section title="Values & Alignment" icon={Heart}>
            <div className="space-y-2">
              {agent.values.map((value) => (
                <div
                  key={value}
                  className="flex items-start gap-3 bg-slate-800/50 border border-slate-700/50 rounded-xl p-3"
                >
                  <div className="w-6 h-6 shrink-0 rounded-full bg-violet-500/20 flex items-center justify-center">
                    <Check className="w-3 h-3 text-violet-400" />
                  </div>
                  <p className="text-sm text-slate-300">{value}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Connectors */}
          <Section title="Connectors" icon={Zap}>
            {agent.connectors.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {agent.connectors.map((connector) => (
                  <ConnectorCard key={connector.id} connector={connector} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-slate-800/50 border border-slate-700/50 rounded-xl">
                <Zap className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-500">No connectors configured</p>
              </div>
            )}
          </Section>

          {/* Context */}
          <Section title="Context & Knowledge" icon={FileText}>
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-4">
              {agent.context.customInstructions && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">
                    Custom Instructions
                  </p>
                  <p className="text-sm text-slate-300 bg-slate-700/50 rounded-lg p-3">
                    {agent.context.customInstructions}
                  </p>
                </div>
              )}
              {agent.context.linkedRepos.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">
                    Linked Repositories
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {agent.context.linkedRepos.map((repo) => (
                      <a
                        key={repo}
                        href={`https://github.com/${repo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-sm transition-colors"
                      >
                        <GitBranch className="w-3 h-3" />
                        {repo}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {agent.context.linkedPackages.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Linked Packages</p>
                  <div className="flex flex-wrap gap-2">
                    {agent.context.linkedPackages.map((pkg) => (
                      <span
                        key={pkg}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                      >
                        <Package className="w-3 h-3" />
                        {pkg}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-between p-6 border-t border-slate-800 bg-slate-900">
          <p className="text-xs text-slate-500">
            Created {new Date(agent.createdAt).toLocaleDateString()}
          </p>
          <div className="flex gap-3">
            <Link
              to={`/dao/${agent.daoId}/agents/${agent.id}/edit`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-medium transition-colors"
            >
              <Settings className="w-4 h-4" />
              Configure Agent
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
