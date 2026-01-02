import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Eye,
  GitBranch,
  Globe,
  Info,
  Link2,
  Loader2,
  Lock,
  MessageSquare,
  Save,
  Shield,
  Twitter,
  Users,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useUpdateDAO } from '../../hooks/useDAO'
import type { DAODetail, DAOVisibility } from '../../types/dao'
import { ConfirmDialog } from '../ConfirmDialog'

interface SettingsTabProps {
  dao: DAODetail
}

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: Omit<SectionProps, 'description'>) {
  return (
    <div className="mb-8">
      <h3
        className="text-lg font-semibold mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

interface InfoRowProps {
  label: string
  value: string
  copyable?: boolean
}

function InfoRow({ label, value, copyable = false }: InfoRowProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [value])

  const displayValue =
    value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value

  return (
    <div
      className="flex items-center justify-between py-3 border-b last:border-0"
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-mono"
          style={{ color: 'var(--text-primary)' }}
        >
          {displayValue}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          >
            {copied ? (
              <Check
                className="w-4 h-4"
                style={{ color: 'var(--color-success)' }}
              />
            ) : (
              <Copy
                className="w-4 h-4"
                style={{ color: 'var(--text-tertiary)' }}
              />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export function SettingsTab({ dao }: SettingsTabProps) {
  const [visibility, setVisibility] = useState<DAOVisibility>(dao.visibility)
  const [farcasterChannel, setFarcasterChannel] = useState(
    dao.farcasterChannel ?? '',
  )
  const [websiteUrl, setWebsiteUrl] = useState(dao.websiteUrl ?? '')
  const [discordUrl, setDiscordUrl] = useState(dao.discordUrl ?? '')
  const [twitterHandle, setTwitterHandle] = useState(dao.twitterHandle ?? '')
  const [githubOrg, setGithubOrg] = useState(dao.githubOrg ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)

  const updateDAO = useUpdateDAO(dao.daoId)

  const hasChanges = useMemo(() => {
    return (
      visibility !== dao.visibility ||
      farcasterChannel !== (dao.farcasterChannel ?? '') ||
      websiteUrl !== (dao.websiteUrl ?? '') ||
      discordUrl !== (dao.discordUrl ?? '') ||
      twitterHandle !== (dao.twitterHandle ?? '') ||
      githubOrg !== (dao.githubOrg ?? '')
    )
  }, [
    visibility,
    farcasterChannel,
    websiteUrl,
    discordUrl,
    twitterHandle,
    githubOrg,
    dao,
  ])

  const handleSave = useCallback(() => {
    setSaveError(null)
    updateDAO.mutate(
      {
        visibility,
        farcasterChannel: farcasterChannel || undefined,
        websiteUrl: websiteUrl || undefined,
        discordUrl: discordUrl || undefined,
        twitterHandle: twitterHandle || undefined,
        githubOrg: githubOrg || undefined,
      },
      {
        onError: (err) => {
          setSaveError(
            err instanceof Error ? err.message : 'Failed to save settings',
          )
        },
      },
    )
  }, [
    visibility,
    farcasterChannel,
    websiteUrl,
    discordUrl,
    twitterHandle,
    githubOrg,
    updateDAO,
  ])

  const visibilityOptions: {
    value: DAOVisibility
    label: string
    description: string
    icon: typeof Eye
  }[] = [
    {
      value: 'public',
      label: 'Public',
      description: 'Listed in directory, open to all',
      icon: Eye,
    },
    {
      value: 'unlisted',
      label: 'Unlisted',
      description: 'Direct link access only',
      icon: Link2,
    },
    {
      value: 'private',
      label: 'Private',
      description: 'Members only',
      icon: Lock,
    },
  ]

  return (
    <div className="max-w-3xl">
      {/* Network DAO Warning */}
      {dao.networkPermissions.isNetworkDAO && (
        <div
          className="mb-8 p-4 rounded-xl"
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}
        >
          <div className="flex items-start gap-3">
            <Shield
              className="w-5 h-5 shrink-0 mt-0.5"
              style={{ color: 'var(--color-warning)' }}
            />
            <div>
              <h4
                className="font-medium"
                style={{ color: 'var(--color-warning)' }}
              >
                Network DAO
              </h4>
              <p
                className="text-sm mt-1"
                style={{ color: 'rgba(245, 158, 11, 0.8)' }}
              >
                Network-level DAO with elevated permissions. Changes may affect
                the entire Jeju Network.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {dao.networkPermissions.canModerateNetwork && (
                  <span
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: 'var(--color-warning)',
                    }}
                  >
                    Network Moderation
                  </span>
                )}
                {dao.networkPermissions.canManageContracts && (
                  <span
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: 'var(--color-warning)',
                    }}
                  >
                    Contract Management
                  </span>
                )}
                {dao.networkPermissions.canApproveDaos && (
                  <span
                    className="px-2 py-1 text-xs rounded"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: 'var(--color-warning)',
                    }}
                  >
                    DAO Approval
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contract Addresses */}
      <Section title="Contract Addresses">
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <InfoRow label="Treasury" value={dao.treasury} copyable />
          <InfoRow label="Council" value={dao.council} copyable />
          <InfoRow label="CEO Agent" value={dao.ceoAgentContract} copyable />
          <InfoRow label="Fee Config" value={dao.feeConfig} copyable />
        </div>
      </Section>

      {/* Visibility */}
      <Section title="Visibility">
        <div className="grid gap-3">
          {visibilityOptions.map((option) => {
            const Icon = option.icon
            const isSelected = visibility === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisibility(option.value)}
                className="flex items-start gap-4 p-4 rounded-xl text-left transition-all"
                style={{
                  backgroundColor: isSelected
                    ? 'rgba(6, 214, 160, 0.08)'
                    : 'var(--surface)',
                  border: isSelected
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--border)',
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: isSelected
                      ? 'rgba(6, 214, 160, 0.15)'
                      : 'var(--bg-secondary)',
                  }}
                >
                  <Icon
                    className="w-5 h-5"
                    style={{
                      color: isSelected
                        ? 'var(--color-primary)'
                        : 'var(--text-secondary)',
                    }}
                    aria-hidden="true"
                  />
                </div>
                <div className="flex-1">
                  <p
                    className="font-medium"
                    style={{
                      color: isSelected
                        ? 'var(--color-primary)'
                        : 'var(--text-primary)',
                    }}
                  >
                    {option.label}
                  </p>
                  <p
                    className="text-sm mt-0.5"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {option.description}
                  </p>
                </div>
                {isSelected && (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    <Check className="w-3 h-3 text-white" aria-hidden="true" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </Section>

      {/* Governance Parameters */}
      <Section title="Governance Parameters">
        <div
          className="rounded-xl p-5 space-y-4"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Min Quality Score
              </span>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.governanceParams.minQualityScore}
              </p>
            </div>
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Min Board Approvals
              </span>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.governanceParams.minBoardApprovals}
              </p>
            </div>
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Voting Period
              </span>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {Math.floor(dao.governanceParams.councilVotingPeriod / 86400)}{' '}
                days
              </p>
            </div>
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Grace Period
              </span>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {Math.floor(dao.governanceParams.gracePeriod / 86400)} days
              </p>
            </div>
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Min Proposal Stake
              </span>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.governanceParams.minProposalStake} ETH
              </p>
            </div>
            <div>
              <span
                className="block text-xs mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Quorum
              </span>
              <p
                className="text-lg font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {dao.governanceParams.quorumBps / 100}%
              </p>
            </div>
          </div>

          <div
            className="pt-4 border-t flex flex-wrap gap-3"
            style={{ borderColor: 'var(--border)' }}
          >
            <span
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{
                backgroundColor: dao.governanceParams.ceoVetoEnabled
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'var(--bg-secondary)',
                color: dao.governanceParams.ceoVetoEnabled
                  ? 'var(--color-success)'
                  : 'var(--text-tertiary)',
              }}
            >
              CEO Veto:{' '}
              {dao.governanceParams.ceoVetoEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <span
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{
                backgroundColor: dao.governanceParams.communityVetoEnabled
                  ? 'rgba(16, 185, 129, 0.12)'
                  : 'var(--bg-secondary)',
                color: dao.governanceParams.communityVetoEnabled
                  ? 'var(--color-success)'
                  : 'var(--text-tertiary)',
              }}
            >
              Community Veto:{' '}
              {dao.governanceParams.communityVetoEnabled
                ? 'Enabled'
                : 'Disabled'}{' '}
              ({dao.governanceParams.vetoThreshold}%)
            </span>
          </div>

          <div
            className="pt-4 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-start gap-2 text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <p>Parameters require a parameter_change proposal to modify.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* External Integrations */}
      <Section title="External Integrations">
        <div className="space-y-4">
          {/* Farcaster */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(139, 92, 246, 0.12)' }}
              >
                <MessageSquare
                  className="w-5 h-5"
                  style={{ color: 'var(--color-secondary)' }}
                />
              </div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Farcaster
              </p>
            </div>
            <input
              type="text"
              value={farcasterChannel}
              onChange={(e) => setFarcasterChannel(e.target.value)}
              placeholder="/your-channel"
              className="input"
              aria-label="Farcaster channel"
            />
          </div>

          {/* Website */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(59, 130, 246, 0.12)' }}
              >
                <Globe
                  className="w-5 h-5"
                  style={{ color: 'var(--color-info)' }}
                />
              </div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Website
              </p>
            </div>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourdao.org"
              className="input"
              aria-label="Website URL"
            />
          </div>

          {/* Discord */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(99, 102, 241, 0.12)' }}
              >
                <Users className="w-5 h-5" style={{ color: '#6366F1' }} />
              </div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Discord
              </p>
            </div>
            <input
              type="url"
              value={discordUrl}
              onChange={(e) => setDiscordUrl(e.target.value)}
              placeholder="https://discord.gg/..."
              className="input"
              aria-label="Discord invite URL"
            />
          </div>

          {/* Twitter */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(14, 165, 233, 0.12)' }}
              >
                <Twitter className="w-5 h-5" style={{ color: '#0EA5E9' }} />
              </div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Twitter / X
              </p>
            </div>
            <input
              type="text"
              value={twitterHandle}
              onChange={(e) => setTwitterHandle(e.target.value)}
              placeholder="@yourdao"
              className="input"
              aria-label="Twitter handle"
            />
          </div>

          {/* GitHub */}
          <div
            className="rounded-xl p-4"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <GitBranch
                  className="w-5 h-5"
                  style={{ color: 'var(--text-secondary)' }}
                />
              </div>
              <p
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                GitHub
              </p>
            </div>
            <input
              type="text"
              value={githubOrg}
              onChange={(e) => setGithubOrg(e.target.value)}
              placeholder="your-org"
              className="input"
              aria-label="GitHub organization"
            />
          </div>
        </div>
      </Section>

      {/* Danger Zone */}
      <Section title="Danger Zone">
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="w-5 h-5 shrink-0 mt-0.5"
              style={{ color: 'var(--color-error)' }}
            />
            <div>
              <h4
                className="font-medium"
                style={{ color: 'var(--color-error)' }}
              >
                Archive DAO
              </h4>
              <p
                className="text-sm mt-1"
                style={{ color: 'rgba(239, 68, 68, 0.8)' }}
              >
                Archiving disables governance and freezes the treasury. Requires
                CEO approval. Reversal requires a network-level proposal.
              </p>
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(true)}
                className="mt-3 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  color: 'var(--color-error)',
                }}
              >
                Request Archive
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        onConfirm={() => {
          setShowArchiveConfirm(false)
          // Archive functionality requires a network-level governance proposal
          // This is by design - archiving a DAO is a significant action that
          // should go through the proper governance process, not a simple button click
          setSaveError(
            'DAO archiving requires a network-level governance proposal. Please submit a proposal through the governance system.',
          )
        }}
        title="Archive DAO"
        description={`Are you sure you want to request archiving "${dao.displayName}"? This will disable governance and freeze the treasury. Reversal requires a network-level proposal.`}
        confirmLabel="Request Archive"
        variant="danger"
      />

      {/* Save Button */}
      <div
        className="sticky bottom-0 -mx-4 px-4 py-4 backdrop-blur-xl border-t"
        style={{
          backgroundColor: 'rgba(var(--bg-primary-rgb, 250, 251, 255), 0.95)',
          borderColor: 'var(--border)',
        }}
      >
        {saveError && (
          <div
            className="mb-3 p-3 rounded-lg flex items-center gap-2"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <AlertCircle
              className="w-4 h-4"
              style={{ color: 'var(--color-error)' }}
            />
            <span className="text-sm" style={{ color: 'var(--color-error)' }}>
              {saveError}
            </span>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateDAO.isPending || !hasChanges}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-primary)' }}
          >
            {updateDAO.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" aria-hidden="true" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
