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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  const statusStyles = {
    active: { bg: 'rgba(16, 185, 129, 0.12)', color: 'var(--color-success)' },
    error: { bg: 'rgba(239, 68, 68, 0.12)', color: 'var(--color-error)' },
    disconnected: {
      bg: 'rgba(148, 163, 184, 0.12)',
      color: 'var(--text-tertiary)',
    },
  }[connector.status]

  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            <Icon
              className="w-5 h-5"
              style={{ color: 'var(--text-secondary)' }}
              aria-hidden="true"
            />
          </div>
          <div>
            <h4
              className="font-medium"
              style={{ color: 'var(--text-primary)' }}
            >
              {label}
            </h4>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {connector.enabled ? 'Enabled' : 'Disabled'}
            </p>
          </div>
        </div>
        <span
          className="px-2 py-0.5 text-xs font-semibold rounded-full"
          style={{
            backgroundColor: statusStyles.bg,
            color: statusStyles.color,
          }}
        >
          {connector.status}
        </span>
      </div>

      {connector.type === 'farcaster' && 'channelUrl' in connector.config && (
        <div
          className="space-y-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <p>
            Channel:{' '}
            <span style={{ color: 'var(--text-primary)' }}>
              {connector.config.channelUrl}
            </span>
          </p>
          <p>
            FID:{' '}
            <span style={{ color: 'var(--text-primary)' }}>
              {connector.config.fid}
            </span>
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {connector.config.autoPost && (
              <span
                className="px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--surface)' }}
              >
                Auto-post
              </span>
            )}
            {connector.config.monitorMentions && (
              <span
                className="px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--surface)' }}
              >
                Monitor mentions
              </span>
            )}
          </div>
        </div>
      )}

      {connector.type === 'github' && 'repoUrl' in connector.config && (
        <div
          className="space-y-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          <p>
            Repo:{' '}
            <span style={{ color: 'var(--text-primary)' }}>
              {connector.config.repoUrl}
            </span>
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {connector.config.autoReviewPRs && (
              <span
                className="px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--surface)' }}
              >
                Auto-review PRs
              </span>
            )}
            {connector.config.webhookEnabled && (
              <span
                className="px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--surface)' }}
              >
                Webhook
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  icon: typeof Brain
  children: React.ReactNode
}

function Section({ title, icon: Icon, children }: SectionProps) {
  return (
    <div className="mb-6">
      <h3
        className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider mb-3"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
        {title}
      </h3>
      {children}
    </div>
  )
}

export function AgentDetailModal({ agent, onClose }: AgentDetailModalProps) {
  const [copied, setCopied] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const copyAgentId = useCallback(() => {
    navigator.clipboard.writeText(agent.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [agent.id])

  const formatLastActive = useMemo(() => {
    const diff = Date.now() - agent.lastActiveAt
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return `${Math.floor(diff / 86400000)}d ago`
  }, [agent.lastActiveAt])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Trap focus
  useEffect(() => {
    const modal = modalRef.current
    if (!modal) return

    const focusableElements = modal.querySelectorAll(
      'button, a[href], input, [tabindex]:not([tabindex="-1"])',
    )
    const firstElement = focusableElements[0] as HTMLElement
    const lastElement = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    modal.addEventListener('keydown', handleTab)
    firstElement?.focus()

    return () => modal.removeEventListener('keydown', handleTab)
  }, [])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 cursor-default border-none"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={onClose}
        aria-label="Close modal"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl animate-scale-in"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-start justify-between p-6 border-b"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-white"
              style={{ background: 'var(--gradient-accent)' }}
            >
              <Bot className="w-8 h-8" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="modal-title"
                className="text-xl font-bold mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.persona.name}
              </h2>
              <p style={{ color: 'var(--text-secondary)' }}>{agent.role}</p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={copyAgentId}
                  className="inline-flex items-center gap-1.5 text-xs transition-colors"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {copied ? (
                    <Check
                      className="w-3 h-3"
                      style={{ color: 'var(--color-success)' }}
                    />
                  ) : (
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  )}
                  {agent.id}
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            aria-label="Close"
          >
            <X
              className="w-5 h-5"
              style={{ color: 'var(--text-secondary)' }}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.decisionsCount}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Decisions
              </p>
            </div>
            <div
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.approvalRate}%
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Approval Rate
              </p>
            </div>
            <div
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {agent.weight}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Weight
              </p>
            </div>
            <div
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-lg font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {formatLastActive}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Last Active
              </p>
            </div>
          </div>

          {/* Persona */}
          <Section title="Persona" icon={Brain}>
            <div
              className="rounded-xl p-4 space-y-4"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {agent.persona.bio && (
                <div>
                  <p
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Bio
                  </p>
                  <p style={{ color: 'var(--text-primary)' }}>
                    {agent.persona.bio}
                  </p>
                </div>
              )}
              {agent.persona.personality && (
                <div>
                  <p
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Personality
                  </p>
                  <p style={{ color: 'var(--text-primary)' }}>
                    {agent.persona.personality}
                  </p>
                </div>
              )}
              {agent.persona.voiceStyle && (
                <div>
                  <p
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Voice Style
                  </p>
                  <p style={{ color: 'var(--text-primary)' }}>
                    {agent.persona.voiceStyle}
                  </p>
                </div>
              )}
              {agent.persona.traits.length > 0 && (
                <div>
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Traits
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {agent.persona.traits.map((trait) => (
                      <span
                        key={trait}
                        className="px-3 py-1 rounded-lg text-sm"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {agent.persona.specialties.length > 0 && (
                <div>
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Specialties
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {agent.persona.specialties.map((specialty) => (
                      <span
                        key={specialty}
                        className="px-3 py-1 rounded-lg text-sm"
                        style={{
                          backgroundColor: 'rgba(139, 92, 246, 0.12)',
                          color: 'var(--color-secondary)',
                        }}
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Model */}
          <Section title="AI Model" icon={Bot}>
            <div
              className="rounded-xl p-4"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4
                    className="font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {agent.modelName}
                  </h4>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {agent.modelProvider}
                  </p>
                </div>
                <span
                  className="px-3 py-1 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    color: 'var(--color-success)',
                  }}
                >
                  Active
                </span>
              </div>
              <div
                className="mt-3 flex items-center gap-4 text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <span>ID: {agent.modelId}</span>
                <span>·</span>
                <span>Decision Style: {agent.decisionStyle}</span>
              </div>
            </div>
          </Section>

          {/* Values */}
          {agent.values.length > 0 && (
            <Section title="Values & Alignment" icon={Heart}>
              <div className="space-y-2">
                {agent.values.map((value) => (
                  <div
                    key={value}
                    className="flex items-start gap-3 rounded-xl p-3"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div
                      className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'rgba(6, 214, 160, 0.15)' }}
                    >
                      <Check
                        className="w-3 h-3"
                        style={{ color: 'var(--color-primary)' }}
                      />
                    </div>
                    <p
                      className="text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Connectors */}
          <Section title="Connectors" icon={Zap}>
            {agent.connectors.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {agent.connectors.map((connector) => (
                  <ConnectorCard key={connector.id} connector={connector} />
                ))}
              </div>
            ) : (
              <div
                className="text-center py-8 rounded-xl"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                <Zap
                  className="w-8 h-8 mx-auto mb-2"
                  style={{ color: 'var(--text-tertiary)' }}
                />
                <p style={{ color: 'var(--text-tertiary)' }}>
                  No active connectors
                </p>
              </div>
            )}
          </Section>

          {/* Context */}
          <Section title="Context & Knowledge" icon={FileText}>
            <div
              className="rounded-xl p-4 space-y-4"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              {agent.context.customInstructions && (
                <div>
                  <p
                    className="text-xs mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Custom Instructions
                  </p>
                  <p
                    className="text-sm rounded-lg p-3"
                    style={{
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {agent.context.customInstructions}
                  </p>
                </div>
              )}
              {agent.context.linkedRepos.length > 0 && (
                <div>
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Linked Repositories
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {agent.context.linkedRepos.map((repo) => (
                      <a
                        key={repo}
                        href={`https://github.com/${repo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm transition-colors"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <GitBranch className="w-3 h-3" aria-hidden="true" />
                        {repo}
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {agent.context.linkedPackages.length > 0 && (
                <div>
                  <p
                    className="text-xs mb-2"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Linked Packages
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {agent.context.linkedPackages.map((pkg) => (
                      <span
                        key={pkg}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm"
                        style={{
                          backgroundColor: 'var(--surface)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Package className="w-3 h-3" aria-hidden="true" />
                        {pkg}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!agent.context.customInstructions &&
                agent.context.linkedRepos.length === 0 &&
                agent.context.linkedPackages.length === 0 && (
                  <p
                    className="text-center py-4"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    No linked context
                  </p>
                )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div
          className="sticky bottom-0 flex items-center justify-between p-6 border-t"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Created {new Date(agent.createdAt).toLocaleDateString()}
          </p>
          <div className="flex gap-3">
            <Link
              to={`/dao/${agent.daoId}/agents/${agent.id}/edit`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-white"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
              Configure Agent
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
