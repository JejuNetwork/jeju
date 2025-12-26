/**
 * Agent Edit Page
 *
 * Full configuration page for editing a DAO agent (CEO or board member).
 */

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Brain,
  ChevronDown,
  ChevronUp,
  Crown,
  GitBranch,
  Heart,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  CONNECTOR_OPTIONS,
  DECISION_STYLE_OPTIONS,
  MODEL_OPTIONS,
  TONE_OPTIONS,
} from '../constants/agent'
import { useAgent, useUpdateAgent } from '../hooks/useDAO'
import {
  BOARD_ROLE_PRESETS,
  type AgentConnector,
  type CommunicationTone,
  type ConnectorType,
  type DAOAgent,
  type DecisionStyle,
  type FarcasterConnectorConfig,
  type GitHubConnectorConfig,
} from '../types/dao'

function Section({
  title,
  description,
  icon: Icon,
  children,
  defaultExpanded = true,
}: {
  title: string
  description?: string
  icon: typeof Bot
  children: React.ReactNode
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Icon className="w-5 h-5 text-violet-400" />
          </div>
          <div className="text-left">
            <h3 className="font-medium text-slate-200">{title}</h3>
            {description && (
              <p className="text-xs text-slate-500">{description}</p>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-slate-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-500" />
        )}
      </button>
      {expanded && (
        <div className="p-4 pt-0 border-t border-slate-800">{children}</div>
      )}
    </div>
  )
}

interface ConnectorFormProps {
  connector: AgentConnector
  onChange: (connector: AgentConnector) => void
  onRemove: () => void
}

function ConnectorForm({ connector, onChange, onRemove }: ConnectorFormProps) {
  const option = CONNECTOR_OPTIONS.find((o) => o.type === connector.type)
  const Icon = option?.icon ?? Zap

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center">
            <Icon className="w-5 h-5 text-slate-300" />
          </div>
          <div>
            <h4 className="font-medium text-slate-200">{option?.label}</h4>
            <p className="text-xs text-slate-500">{option?.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={connector.enabled}
              onChange={(e) =>
                onChange({ ...connector, enabled: e.target.checked })
              }
              className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
            />
            <span className="text-sm text-slate-400">Enabled</span>
          </label>
          <button
            type="button"
            onClick={onRemove}
            className="p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Farcaster Config */}
      {connector.type === 'farcaster' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Channel URL
              </label>
              <input
                type="text"
                value={(connector.config as FarcasterConnectorConfig).channelUrl ?? ''}
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: { ...connector.config, channelUrl: e.target.value },
                  })
                }
                placeholder="/your-channel"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">FID</label>
              <input
                type="number"
                value={(connector.config as FarcasterConnectorConfig).fid ?? ''}
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: {
                      ...connector.config,
                      fid: Number.parseInt(e.target.value),
                    },
                  })
                }
                placeholder="12345"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  (connector.config as FarcasterConnectorConfig).autoPost ?? false
                }
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: { ...connector.config, autoPost: e.target.checked },
                  })
                }
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
              />
              <span className="text-sm text-slate-400">Auto-post</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  (connector.config as FarcasterConnectorConfig).monitorMentions ??
                  false
                }
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: {
                      ...connector.config,
                      monitorMentions: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
              />
              <span className="text-sm text-slate-400">Monitor mentions</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  (connector.config as FarcasterConnectorConfig).postDecisions ??
                  false
                }
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: {
                      ...connector.config,
                      postDecisions: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
              />
              <span className="text-sm text-slate-400">Post decisions</span>
            </label>
          </div>
        </div>
      )}

      {/* GitHub Config */}
      {connector.type === 'github' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Repository URL
            </label>
            <input
              type="text"
              value={(connector.config as GitHubConnectorConfig).repoUrl ?? ''}
              onChange={(e) =>
                onChange({
                  ...connector,
                  config: { ...connector.config, repoUrl: e.target.value },
                })
              }
              placeholder="https://github.com/org/repo"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 text-sm placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  (connector.config as GitHubConnectorConfig).webhookEnabled ??
                  false
                }
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: {
                      ...connector.config,
                      webhookEnabled: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
              />
              <span className="text-sm text-slate-400">Webhook</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  (connector.config as GitHubConnectorConfig).autoReviewPRs ??
                  false
                }
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: {
                      ...connector.config,
                      autoReviewPRs: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
              />
              <span className="text-sm text-slate-400">Auto-review PRs</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  (connector.config as GitHubConnectorConfig).autoLabelIssues ??
                  false
                }
                onChange={(e) =>
                  onChange({
                    ...connector,
                    config: {
                      ...connector.config,
                      autoLabelIssues: e.target.checked,
                    },
                  })
                }
                className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-violet-500"
              />
              <span className="text-sm text-slate-400">Auto-label issues</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AgentEditPage() {
  const { daoId, agentId } = useParams<{ daoId: string; agentId: string }>()
  const navigate = useNavigate()
  const [saveError, setSaveError] = useState<string | null>(null)

  // Use real API hooks
  const {
    data: agent,
    isLoading: loading,
    error,
    refetch,
  } = useAgent(daoId, agentId)

  const updateAgentMutation = useUpdateAgent(daoId ?? '', agentId ?? '')

  // Form state
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [personality, setPersonality] = useState('')
  const [voiceStyle, setVoiceStyle] = useState('')
  const [tone, setTone] = useState<CommunicationTone>('professional')
  const [traits, setTraits] = useState<string[]>([])
  const [traitInput, setTraitInput] = useState('')
  const [specialties, setSpecialties] = useState<string[]>([])
  const [specialtyInput, setSpecialtyInput] = useState('')
  const [modelId, setModelId] = useState('claude-opus-4-5-20250514')
  const [decisionStyle, setDecisionStyle] = useState<DecisionStyle>('balanced')
  const [weight, setWeight] = useState(25)
  const [values, setValues] = useState<string[]>([''])
  const [connectors, setConnectors] = useState<AgentConnector[]>([])
  const [customInstructions, setCustomInstructions] = useState('')
  const [linkedRepos, setLinkedRepos] = useState<string[]>([])
  const [repoInput, setRepoInput] = useState('')
  const [linkedPackages, setLinkedPackages] = useState<string[]>([])
  const [packageInput, setPackageInput] = useState('')

  const isCEO = agent?.role === 'CEO'

  // Populate form state when agent data loads
  useEffect(() => {
    if (agent) {
      setName(agent.persona.name)
      setBio(agent.persona.bio)
      setPersonality(agent.persona.personality)
      setVoiceStyle(agent.persona.voiceStyle)
      setTone(agent.persona.communicationTone)
      setTraits(agent.persona.traits)
      setSpecialties(agent.persona.specialties)
      setModelId(agent.modelId)
      setDecisionStyle(agent.decisionStyle)
      setWeight(agent.weight)
      setValues(agent.values.length > 0 ? agent.values : [''])
      setConnectors(agent.connectors)
      setCustomInstructions(agent.context.customInstructions)
      setLinkedRepos(agent.context.linkedRepos)
      setLinkedPackages(agent.context.linkedPackages)
    }
  }, [agent])

  const handleSave = async () => {
    setSaveError(null)

    const updates: Partial<DAOAgent> = {
      persona: {
        name,
        avatarCid: agent?.persona.avatarCid ?? '',
        bio,
        personality,
        traits,
        voiceStyle,
        communicationTone: tone,
        specialties,
      },
      modelId,
      decisionStyle,
      weight,
      values: values.filter((v) => v.trim().length > 0),
      connectors,
      context: {
        knowledgeCids: agent?.context.knowledgeCids ?? [],
        linkedRepos,
        linkedPackages,
        customInstructions,
        maxContextTokens: agent?.context.maxContextTokens ?? 128000,
      },
    }

    updateAgentMutation.mutate(updates, {
      onSuccess: () => {
        navigate(`/dao/${daoId}?tab=agents`)
      },
      onError: (err) => {
        setSaveError(err instanceof Error ? err.message : 'Failed to save agent')
      },
    })
  }

  const addTrait = () => {
    if (traitInput.trim() && !traits.includes(traitInput.trim())) {
      setTraits([...traits, traitInput.trim()])
      setTraitInput('')
    }
  }

  const removeTrait = (trait: string) => {
    setTraits(traits.filter((t) => t !== trait))
  }

  const addSpecialty = () => {
    if (specialtyInput.trim() && !specialties.includes(specialtyInput.trim())) {
      setSpecialties([...specialties, specialtyInput.trim()])
      setSpecialtyInput('')
    }
  }

  const removeSpecialty = (specialty: string) => {
    setSpecialties(specialties.filter((s) => s !== specialty))
  }

  const updateValue = (index: number, value: string) => {
    const newValues = [...values]
    newValues[index] = value
    setValues(newValues)
  }

  const addValue = () => {
    setValues([...values, ''])
  }

  const removeValue = (index: number) => {
    if (values.length > 1) {
      setValues(values.filter((_, i) => i !== index))
    }
  }

  const addConnector = (type: ConnectorType) => {
    const newConnector: AgentConnector = {
      id: `${type}-${Date.now()}`,
      type,
      enabled: true,
      config:
        type === 'farcaster'
          ? {
              channelUrl: '',
              fid: 0,
              autoPost: false,
              monitorMentions: true,
              postDecisions: false,
              postProposals: false,
            }
          : type === 'github'
            ? {
                repoUrl: '',
                webhookEnabled: true,
                autoReviewPRs: true,
                autoLabelIssues: false,
              }
            : ({} as AgentConnector['config']),
      lastSync: 0,
      status: 'disconnected',
    }
    setConnectors([...connectors, newConnector])
  }

  const updateConnector = (index: number, connector: AgentConnector) => {
    const newConnectors = [...connectors]
    newConnectors[index] = connector
    setConnectors(newConnectors)
  }

  const removeConnector = (index: number) => {
    setConnectors(connectors.filter((_, i) => i !== index))
  }

  const addRepo = () => {
    if (repoInput.trim() && !linkedRepos.includes(repoInput.trim())) {
      setLinkedRepos([...linkedRepos, repoInput.trim()])
      setRepoInput('')
    }
  }

  const removeRepo = (repo: string) => {
    setLinkedRepos(linkedRepos.filter((r) => r !== repo))
  }

  const addPackage = () => {
    if (packageInput.trim() && !linkedPackages.includes(packageInput.trim())) {
      setLinkedPackages([...linkedPackages, packageInput.trim()])
      setPackageInput('')
    }
  }

  const removePackage = (pkg: string) => {
    setLinkedPackages(linkedPackages.filter((p) => p !== pkg))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-slate-200 mb-2">
            Failed to load agent
          </h2>
          <p className="text-slate-500 mb-4">
            {error instanceof Error ? error.message : 'An unknown error occurred'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
            <Link
              to={`/dao/${daoId}?tab=agents`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Agents
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-slate-200 mb-2">
            Agent Not Found
          </h2>
          <Link
            to={`/dao/${daoId}?tab=agents`}
            className="text-violet-400 hover:text-violet-300"
          >
            Back to Agents
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to={`/dao/${daoId}?tab=agents`}
                className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    isCEO
                      ? 'bg-gradient-to-br from-violet-500 to-pink-500'
                      : 'bg-slate-700'
                  }`}
                >
                  {isCEO ? (
                    <Crown className="w-6 h-6 text-white" />
                  ) : (
                    <Bot className="w-6 h-6 text-slate-300" />
                  )}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">{agent.persona.name}</h1>
                  <p className="text-sm text-slate-500">
                    {isCEO ? 'CEO' : BOARD_ROLE_PRESETS[agent.role].name}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {saveError && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {saveError}
                </div>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={updateAgentMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 text-white rounded-xl font-medium transition-colors"
              >
                {updateAgentMutation.isPending ? (
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
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        {/* Persona Section */}
        <Section title="Persona" description="Identity and personality" icon={Brain}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Personality
              </label>
              <textarea
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Voice Style
              </label>
              <input
                type="text"
                value={voiceStyle}
                onChange={(e) => setVoiceStyle(e.target.value)}
                placeholder="How the agent communicates"
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Communication Tone
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as CommunicationTone)}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
              >
                {TONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Traits
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {traits.map((trait) => (
                  <span
                    key={trait}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                  >
                    {trait}
                    <button
                      type="button"
                      onClick={() => removeTrait(trait)}
                      className="hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={traitInput}
                  onChange={(e) => setTraitInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTrait()}
                  placeholder="Add a trait"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
                />
                <button
                  type="button"
                  onClick={addTrait}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Specialties
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {specialties.map((specialty) => (
                  <span
                    key={specialty}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-500/20 text-violet-300 rounded-lg text-sm"
                  >
                    {specialty}
                    <button
                      type="button"
                      onClick={() => removeSpecialty(specialty)}
                      className="hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={specialtyInput}
                  onChange={(e) => setSpecialtyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSpecialty()}
                  placeholder="Add a specialty"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
                />
                <button
                  type="button"
                  onClick={addSpecialty}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* AI Model Section */}
        <Section title="AI Model" description="Model and decision settings" icon={Bot}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Model
              </label>
              <div className="grid grid-cols-2 gap-2">
                {MODEL_OPTIONS.map((model) => {
                  const isSelected = modelId === model.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setModelId(model.id)}
                      className={`p-3 rounded-xl border text-left transition-colors ${
                        isSelected
                          ? 'bg-violet-500/20 border-violet-500/50'
                          : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <p
                        className={`text-sm font-medium ${isSelected ? 'text-violet-300' : 'text-slate-200'}`}
                      >
                        {model.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {model.provider} • {model.tier}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Decision Style
              </label>
              <div className="flex gap-2">
                {DECISION_STYLE_OPTIONS.map((style) => {
                  const isSelected = decisionStyle === style.value
                  return (
                    <button
                      key={style.value}
                      type="button"
                      onClick={() => setDecisionStyle(style.value)}
                      className={`flex-1 p-3 rounded-xl border text-center transition-colors ${
                        isSelected
                          ? 'bg-violet-500/20 border-violet-500/50'
                          : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      <p
                        className={`text-sm font-medium ${isSelected ? 'text-violet-300' : 'text-slate-200'}`}
                      >
                        {style.label}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {style.description}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
            {!isCEO && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Voting Weight ({weight}%)
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={weight}
                  onChange={(e) => setWeight(Number.parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>5%</span>
                  <span>50%</span>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Values Section */}
        <Section title="Values & Alignment" description="Core values and principles" icon={Heart}>
          <div className="space-y-2">
            {values.map((value, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={value}
                  onChange={(e) => updateValue(index, e.target.value)}
                  placeholder="e.g., Security is paramount"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                />
                {values.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeValue(index)}
                    className="p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addValue}
              className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300"
            >
              <Plus className="w-4 h-4" />
              Add Value
            </button>
          </div>
        </Section>

        {/* Connectors Section */}
        <Section title="Connectors" description="External integrations" icon={Zap}>
          <div className="space-y-4">
            {connectors.length > 0 && (
              <div className="space-y-3">
                {connectors.map((connector, index) => (
                  <ConnectorForm
                    key={connector.id}
                    connector={connector}
                    onChange={(c) => updateConnector(index, c)}
                    onRemove={() => removeConnector(index)}
                  />
                ))}
              </div>
            )}
            <div>
              <p className="text-sm text-slate-400 mb-2">Add connector:</p>
              <div className="flex flex-wrap gap-2">
                {CONNECTOR_OPTIONS.filter(
                  (opt) => !connectors.some((c) => c.type === opt.type),
                ).map((opt) => {
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => addConnector(opt.type)}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 transition-colors"
                    >
                      <Icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Section>

        {/* Context Section */}
        <Section
          title="Context & Knowledge"
          description="Knowledge sources and instructions"
          icon={Package}
          defaultExpanded={false}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Custom Instructions
              </label>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Additional instructions for the agent..."
                rows={4}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Linked Repositories
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {linkedRepos.map((repo) => (
                  <span
                    key={repo}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                  >
                    <GitBranch className="w-3 h-3" />
                    {repo}
                    <button
                      type="button"
                      onClick={() => removeRepo(repo)}
                      className="hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRepo()}
                  placeholder="org/repo"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
                />
                <button
                  type="button"
                  onClick={addRepo}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Linked Packages
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {linkedPackages.map((pkg) => (
                  <span
                    key={pkg}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-700 text-slate-300 rounded-lg text-sm"
                  >
                    <Package className="w-3 h-3" />
                    {pkg}
                    <button
                      type="button"
                      onClick={() => removePackage(pkg)}
                      className="hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={packageInput}
                  onChange={(e) => setPackageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPackage()}
                  placeholder="@org/package"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
                />
                <button
                  type="button"
                  onClick={addPackage}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* Danger Zone for non-CEO */}
        {!isCEO && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-red-300">Remove Board Member</h4>
                <p className="text-sm text-red-200/70 mt-1">
                  Removing a board member will delete all their voting history and
                  configuration. This action requires CEO approval.
                </p>
                <button
                  type="button"
                  className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 rounded-lg text-sm font-medium transition-colors"
                >
                  Request Removal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
