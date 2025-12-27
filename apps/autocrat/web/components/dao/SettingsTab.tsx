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
import { useState } from 'react'
import { useUpdateDAO } from '../../hooks/useDAO'
import type { DAODetail, DAOVisibility } from '../../types/dao'

interface SettingsTabProps {
  dao: DAODetail
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-200">{title}</h3>
        {description && (
          <p className="text-sm text-slate-500 mt-1">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function InfoRow({
  label,
  value,
  copyable = false,
}: {
  label: string
  value: string
  copyable?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-200 font-mono">
          {value.length > 20
            ? `${value.slice(0, 8)}...${value.slice(-6)}`
            : value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4 text-slate-500" />
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

  const updateDAO = useUpdateDAO(dao.daoId)

  const hasChanges =
    visibility !== dao.visibility ||
    farcasterChannel !== (dao.farcasterChannel ?? '') ||
    websiteUrl !== (dao.websiteUrl ?? '') ||
    discordUrl !== (dao.discordUrl ?? '') ||
    twitterHandle !== (dao.twitterHandle ?? '') ||
    githubOrg !== (dao.githubOrg ?? '')

  const handleSave = () => {
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
  }

  const visibilityOptions: {
    value: DAOVisibility
    label: string
    description: string
    icon: typeof Eye
  }[] = [
    {
      value: 'public',
      label: 'Public',
      description: 'Anyone can discover and view this DAO',
      icon: Eye,
    },
    {
      value: 'unlisted',
      label: 'Unlisted',
      description: 'Only accessible via direct link',
      icon: Link2,
    },
    {
      value: 'private',
      label: 'Private',
      description: 'Only visible to members',
      icon: Lock,
    },
  ]

  return (
    <div className="max-w-3xl">
      {/* Network DAO Warning */}
      {dao.networkPermissions.isNetworkDAO && (
        <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-300">Network DAO</h4>
              <p className="text-sm text-amber-200/70 mt-1">
                This is a network-level DAO with special permissions. Changes
                here may affect the entire Jeju Network. Proceed with caution.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {dao.networkPermissions.canModerateNetwork && (
                  <span className="px-2 py-1 text-xs bg-amber-500/20 text-amber-300 rounded">
                    Network Moderation
                  </span>
                )}
                {dao.networkPermissions.canManageContracts && (
                  <span className="px-2 py-1 text-xs bg-amber-500/20 text-amber-300 rounded">
                    Contract Management
                  </span>
                )}
                {dao.networkPermissions.canApproveDaos && (
                  <span className="px-2 py-1 text-xs bg-amber-500/20 text-amber-300 rounded">
                    DAO Approval
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contract Addresses */}
      <Section
        title="Contract Addresses"
        description="On-chain contract addresses for this DAO"
      >
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
          <InfoRow label="Treasury" value={dao.treasury} copyable />
          <InfoRow label="Council" value={dao.council} copyable />
          <InfoRow label="CEO Agent" value={dao.ceoAgentContract} copyable />
          <InfoRow label="Fee Config" value={dao.feeConfig} copyable />
        </div>
      </Section>

      {/* Visibility */}
      <Section
        title="Visibility"
        description="Control who can discover and view this DAO"
      >
        <div className="grid gap-3">
          {visibilityOptions.map((option) => {
            const Icon = option.icon
            const isSelected = visibility === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisibility(option.value)}
                className={`flex items-start gap-4 p-4 rounded-xl border text-left transition-colors ${
                  isSelected
                    ? 'bg-violet-500/10 border-violet-500/50'
                    : 'bg-slate-900/50 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? 'bg-violet-500/20' : 'bg-slate-800'}`}
                >
                  <Icon
                    className={`w-5 h-5 ${isSelected ? 'text-violet-400' : 'text-slate-400'}`}
                  />
                </div>
                <div className="flex-1">
                  <p
                    className={`font-medium ${isSelected ? 'text-violet-300' : 'text-slate-200'}`}
                  >
                    {option.label}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {option.description}
                  </p>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </Section>

      {/* Governance Parameters */}
      <Section
        title="Governance Parameters"
        description="Settings that control how proposals are evaluated and approved"
      >
        <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="block text-xs text-slate-500 mb-1">
                Min Quality Score
              </span>
              <p className="text-lg font-semibold text-slate-200">
                {dao.governanceParams.minQualityScore}
              </p>
            </div>
            <div>
              <span className="block text-xs text-slate-500 mb-1">
                Min Board Approvals
              </span>
              <p className="text-lg font-semibold text-slate-200">
                {dao.governanceParams.minBoardApprovals}
              </p>
            </div>
            <div>
              <span className="block text-xs text-slate-500 mb-1">
                Voting Period
              </span>
              <p className="text-lg font-semibold text-slate-200">
                {Math.floor(dao.governanceParams.councilVotingPeriod / 86400)}{' '}
                days
              </p>
            </div>
            <div>
              <span className="block text-xs text-slate-500 mb-1">
                Grace Period
              </span>
              <p className="text-lg font-semibold text-slate-200">
                {Math.floor(dao.governanceParams.gracePeriod / 86400)} days
              </p>
            </div>
            <div>
              <span className="block text-xs text-slate-500 mb-1">
                Min Proposal Stake
              </span>
              <p className="text-lg font-semibold text-slate-200">
                {dao.governanceParams.minProposalStake} ETH
              </p>
            </div>
            <div>
              <span className="block text-xs text-slate-500 mb-1">Quorum</span>
              <p className="text-lg font-semibold text-slate-200">
                {dao.governanceParams.quorumBps / 100}%
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-700 flex flex-wrap gap-3">
            <span
              className={`px-3 py-1.5 rounded-lg text-sm ${dao.governanceParams.ceoVetoEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}
            >
              CEO Veto:{' '}
              {dao.governanceParams.ceoVetoEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <span
              className={`px-3 py-1.5 rounded-lg text-sm ${dao.governanceParams.communityVetoEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}
            >
              Community Veto:{' '}
              {dao.governanceParams.communityVetoEnabled
                ? 'Enabled'
                : 'Disabled'}{' '}
              ({dao.governanceParams.vetoThreshold}%)
            </span>
          </div>

          <div className="pt-4 border-t border-slate-700">
            <div className="flex items-start gap-2 text-sm text-slate-500">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Governance parameters can only be changed through an approved
                parameter_change proposal.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* External Links / Integrations */}
      <Section
        title="External Integrations"
        description="Connect your DAO to external platforms and services"
      >
        <div className="space-y-4">
          {/* Farcaster */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="font-medium text-slate-200">Farcaster Channel</p>
                <p className="text-xs text-slate-500">
                  Link to your Farcaster channel for announcements
                </p>
              </div>
            </div>
            <input
              type="text"
              value={farcasterChannel}
              onChange={(e) => setFarcasterChannel(e.target.value)}
              placeholder="/your-channel"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Website */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Globe className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="font-medium text-slate-200">Website</p>
                <p className="text-xs text-slate-500">Your DAO website URL</p>
              </div>
            </div>
            <input
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://yourdao.org"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Discord */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <p className="font-medium text-slate-200">Discord</p>
                <p className="text-xs text-slate-500">
                  Discord server invite link
                </p>
              </div>
            </div>
            <input
              type="url"
              value={discordUrl}
              onChange={(e) => setDiscordUrl(e.target.value)}
              placeholder="https://discord.gg/..."
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Twitter */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center">
                <Twitter className="w-5 h-5 text-sky-400" />
              </div>
              <div>
                <p className="font-medium text-slate-200">Twitter / X</p>
                <p className="text-xs text-slate-500">Twitter handle</p>
              </div>
            </div>
            <input
              type="text"
              value={twitterHandle}
              onChange={(e) => setTwitterHandle(e.target.value)}
              placeholder="@yourdao"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* GitHub */}
          <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-slate-500/20 flex items-center justify-center">
                <GitBranch className="w-5 h-5 text-slate-400" />
              </div>
              <div>
                <p className="font-medium text-slate-200">
                  GitHub Organization
                </p>
                <p className="text-xs text-slate-500">GitHub org name</p>
              </div>
            </div>
            <input
              type="text"
              value={githubOrg}
              onChange={(e) => setGithubOrg(e.target.value)}
              placeholder="your-org"
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>
      </Section>

      {/* Danger Zone */}
      <Section title="Danger Zone">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-red-300">Archive DAO</h4>
              <p className="text-sm text-red-200/70 mt-1">
                Archiving will disable all governance activities and freeze the
                treasury. This action requires CEO approval and can only be
                reversed through a network-level proposal.
              </p>
              <button
                type="button"
                className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium transition-colors"
              >
                Request Archive
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Save Button */}
      <div className="sticky bottom-0 -mx-4 px-4 py-4 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800">
        {saveError && (
          <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-300">{saveError}</span>
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={updateDAO.isPending || !hasChanges}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors"
          >
            {updateDAO.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
