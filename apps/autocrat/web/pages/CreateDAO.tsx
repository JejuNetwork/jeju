import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Heart,
  Loader2,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  DECISION_STYLE_OPTIONS,
  MODEL_OPTIONS,
  TONE_OPTIONS,
} from '../constants/agent'
import { useCreateDAO } from '../hooks/useDAO'
import {
  type AgentRole,
  BOARD_ROLE_PRESETS,
  type CommunicationTone,
  type CreateAgentDraft,
  type CreateDAODraft,
  DEFAULT_GOVERNANCE_PARAMS,
} from '../types/dao'

type WizardStep = 'basics' | 'ceo' | 'board' | 'governance' | 'review'

const STEPS: { id: WizardStep; label: string; icon: typeof Bot }[] = [
  { id: 'basics', label: 'Basics', icon: Settings },
  { id: 'ceo', label: 'CEO', icon: Crown },
  { id: 'board', label: 'Board', icon: Users },
  { id: 'governance', label: 'Governance', icon: Shield },
  { id: 'review', label: 'Review', icon: Check },
]

const BOARD_ROLE_OPTIONS: AgentRole[] = [
  'TREASURY',
  'CODE',
  'COMMUNITY',
  'SECURITY',
  'LEGAL',
  'CUSTOM',
]

function createEmptyCEO(): CreateAgentDraft {
  return {
    role: 'CEO',
    persona: {
      name: '',
      avatarCid: '',
      bio: '',
      personality: '',
      traits: [],
      voiceStyle: '',
      communicationTone: 'professional',
      specialties: [],
    },
    modelId: 'claude-opus-4-5-20250514',
    weight: 100,
    values: [''],
    decisionStyle: 'balanced',
  }
}

function createBoardMember(role: AgentRole): CreateAgentDraft {
  const preset = BOARD_ROLE_PRESETS[role]
  return {
    role,
    customRoleName: role === 'CUSTOM' ? '' : undefined,
    persona: {
      name: '',
      avatarCid: '',
      bio: '',
      personality: preset.defaultPersonality,
      traits: [],
      voiceStyle: '',
      communicationTone: 'professional',
      specialties: [],
    },
    modelId: 'claude-sonnet-4-20250514',
    weight: 25,
    values: [''],
    decisionStyle: 'balanced',
  }
}

interface AgentFormProps {
  agent: CreateAgentDraft
  onChange: (agent: CreateAgentDraft) => void
  isCEO?: boolean
  onRemove?: () => void
}

function AgentForm({
  agent,
  onChange,
  isCEO = false,
  onRemove,
}: AgentFormProps) {
  const [expanded, setExpanded] = useState(true)
  const preset = BOARD_ROLE_PRESETS[agent.role]

  const updatePersona = useCallback(
    (updates: Partial<CreateAgentDraft['persona']>) => {
      onChange({ ...agent, persona: { ...agent.persona, ...updates } })
    },
    [agent, onChange],
  )

  const updateValue = useCallback(
    (index: number, value: string) => {
      const newValues = [...agent.values]
      newValues[index] = value
      onChange({ ...agent, values: newValues })
    },
    [agent, onChange],
  )

  const addValue = useCallback(() => {
    onChange({ ...agent, values: [...agent.values, ''] })
  }, [agent, onChange])

  const removeValue = useCallback(
    (index: number) => {
      onChange({ ...agent, values: agent.values.filter((_, i) => i !== index) })
    },
    [agent, onChange],
  )

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 transition-colors"
        style={{ backgroundColor: expanded ? 'transparent' : 'var(--surface)' }}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: isCEO
                ? 'var(--gradient-accent)'
                : 'var(--gradient-secondary)',
            }}
          >
            {isCEO ? (
              <Crown className="w-5 h-5 text-white" aria-hidden="true" />
            ) : (
              <Bot className="w-5 h-5 text-white" aria-hidden="true" />
            )}
          </div>
          <div className="text-left">
            <p
              className="font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {agent.persona.name || (isCEO ? 'CEO' : preset.name)}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {isCEO ? 'Chief Executive Officer' : preset.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isCEO && onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              aria-label="Remove board member"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {expanded ? (
            <ChevronUp
              className="w-5 h-5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          ) : (
            <ChevronDown
              className="w-5 h-5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          )}
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div
          className="p-4 pt-0 space-y-4 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          {/* Role Selection (for non-CEO) */}
          {!isCEO && (
            <div>
              <label
                htmlFor={`role-${agent.persona.name}`}
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Role
              </label>
              <select
                id={`role-${agent.persona.name}`}
                value={agent.role}
                onChange={(e) => {
                  const newRole = e.target.value as AgentRole
                  const newPreset = BOARD_ROLE_PRESETS[newRole]
                  onChange({
                    ...agent,
                    role: newRole,
                    customRoleName: newRole === 'CUSTOM' ? '' : undefined,
                    persona: {
                      ...agent.persona,
                      personality: newPreset.defaultPersonality,
                    },
                  })
                }}
                className="select"
              >
                {BOARD_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {BOARD_ROLE_PRESETS[role].name}
                  </option>
                ))}
              </select>
              {agent.role === 'CUSTOM' && (
                <input
                  type="text"
                  value={agent.customRoleName ?? ''}
                  onChange={(e) =>
                    onChange({ ...agent, customRoleName: e.target.value })
                  }
                  placeholder="Custom role name"
                  className="input mt-2"
                />
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label
              htmlFor={`agent-name-${isCEO ? 'ceo' : 'board'}`}
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Agent Name
            </label>
            <input
              id={`agent-name-${isCEO ? 'ceo' : 'board'}`}
              type="text"
              value={agent.persona.name}
              onChange={(e) => updatePersona({ name: e.target.value })}
              placeholder={
                isCEO ? 'e.g., Eliza, Atlas' : `e.g., ${preset.name}`
              }
              className="input"
            />
          </div>

          {/* Bio */}
          <div>
            <label
              htmlFor={`agent-bio-${isCEO ? 'ceo' : 'board'}`}
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Bio
            </label>
            <textarea
              id={`agent-bio-${isCEO ? 'ceo' : 'board'}`}
              value={agent.persona.bio}
              onChange={(e) => updatePersona({ bio: e.target.value })}
              placeholder="What this agent focuses on and how they contribute"
              rows={2}
              className="textarea"
            />
          </div>

          {/* Personality */}
          <div>
            <label
              htmlFor={`agent-personality-${isCEO ? 'ceo' : 'board'}`}
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Personality
            </label>
            <textarea
              id={`agent-personality-${isCEO ? 'ceo' : 'board'}`}
              value={agent.persona.personality}
              onChange={(e) => updatePersona({ personality: e.target.value })}
              placeholder="How this agent approaches decisions and communicates"
              rows={2}
              className="textarea"
            />
          </div>

          {/* Model */}
          <div>
            <span
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              AI Model
            </span>
            <div className="grid grid-cols-2 gap-2">
              {MODEL_OPTIONS.map((model) => {
                const isSelected = agent.modelId === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onChange({ ...agent, modelId: model.id })}
                    className="p-3 rounded-xl text-left transition-all"
                    style={{
                      backgroundColor: isSelected
                        ? 'rgba(6, 214, 160, 0.12)'
                        : 'var(--bg-secondary)',
                      border: isSelected
                        ? '1px solid rgba(6, 214, 160, 0.4)'
                        : '1px solid var(--border)',
                    }}
                  >
                    <p
                      className="text-sm font-medium"
                      style={{
                        color: isSelected
                          ? 'var(--color-primary)'
                          : 'var(--text-primary)',
                      }}
                    >
                      {model.name}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {model.provider}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Decision Style */}
          <div>
            <span
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Decision Style
            </span>
            <div className="flex gap-2">
              {DECISION_STYLE_OPTIONS.map((style) => {
                const isSelected = agent.decisionStyle === style.value
                return (
                  <button
                    key={style.value}
                    type="button"
                    onClick={() =>
                      onChange({ ...agent, decisionStyle: style.value })
                    }
                    className="flex-1 p-3 rounded-xl text-center transition-all"
                    style={{
                      backgroundColor: isSelected
                        ? 'rgba(6, 214, 160, 0.12)'
                        : 'var(--bg-secondary)',
                      border: isSelected
                        ? '1px solid rgba(6, 214, 160, 0.4)'
                        : '1px solid var(--border)',
                    }}
                  >
                    <p
                      className="text-sm font-medium"
                      style={{
                        color: isSelected
                          ? 'var(--color-primary)'
                          : 'var(--text-primary)',
                      }}
                    >
                      {style.label}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {style.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Communication Tone */}
          <div>
            <label
              htmlFor={`comm-tone-${isCEO ? 'ceo' : 'board'}`}
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              Communication Tone
            </label>
            <select
              id={`comm-tone-${isCEO ? 'ceo' : 'board'}`}
              value={agent.persona.communicationTone}
              onChange={(e) =>
                updatePersona({
                  communicationTone: e.target.value as CommunicationTone,
                })
              }
              className="select"
            >
              {TONE_OPTIONS.map((tone) => (
                <option key={tone.value} value={tone.value}>
                  {tone.label}
                </option>
              ))}
            </select>
          </div>

          {/* Values */}
          <div>
            <span
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Heart className="w-4 h-4 inline mr-1" aria-hidden="true" />
              Core Values
            </span>
            <div className="space-y-2">
              {agent.values.map((value, index) => (
                <div
                  key={value ? `${value}-${index}` : `empty-${index}`}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => updateValue(index, e.target.value)}
                    placeholder="e.g., Security is paramount"
                    className="input flex-1"
                  />
                  {agent.values.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeValue(index)}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                      aria-label="Remove value"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addValue}
                className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
                style={{ color: 'var(--color-primary)' }}
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Value
              </button>
            </div>
          </div>

          {/* Weight (for non-CEO) */}
          {!isCEO && (
            <div>
              <label
                htmlFor={`weight-${agent.persona.name}`}
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Voting Weight ({agent.weight}%)
              </label>
              <input
                id={`weight-${agent.persona.name}`}
                type="range"
                min="5"
                max="50"
                step="5"
                value={agent.weight}
                onChange={(e) =>
                  onChange({
                    ...agent,
                    weight: Number.parseInt(e.target.value, 10),
                  })
                }
                className="w-full accent-[var(--color-primary)]"
              />
              <div
                className="flex justify-between text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <span>5%</span>
                <span>50%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CreateDAOPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<WizardStep>('basics')
  const createDAOMutation = useCreateDAO()
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [farcasterChannel, setFarcasterChannel] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [ceo, setCeo] = useState<CreateAgentDraft>(createEmptyCEO())
  const [board, setBoard] = useState<CreateAgentDraft[]>([
    createBoardMember('TREASURY'),
    createBoardMember('CODE'),
    createBoardMember('COMMUNITY'),
  ])
  const [governanceParams, setGovernanceParams] = useState(
    DEFAULT_GOVERNANCE_PARAMS,
  )

  const currentStepIndex = useMemo(
    () => STEPS.findIndex((s) => s.id === step),
    [step],
  )

  const goNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex].id)
    }
  }, [currentStepIndex])

  const goPrev = useCallback(() => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex].id)
    }
  }, [currentStepIndex])

  const addBoardMember = useCallback(() => {
    setBoard((prev) => [...prev, createBoardMember('CUSTOM')])
  }, [])

  const removeBoardMember = useCallback((index: number) => {
    setBoard((prev) =>
      prev.length > 3 ? prev.filter((_, i) => i !== index) : prev,
    )
  }, [])

  const updateBoardMember = useCallback(
    (index: number, agent: CreateAgentDraft) => {
      setBoard((prev) => {
        const newBoard = [...prev]
        newBoard[index] = agent
        return newBoard
      })
    },
    [],
  )

  const addTag = useCallback(() => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags((prev) => [...prev, tagInput.trim()])
      setTagInput('')
    }
  }, [tagInput, tags])

  const handleSubmit = useCallback(async () => {
    setSubmitError(null)

    const draft: CreateDAODraft = {
      name,
      displayName,
      description,
      avatarCid: '',
      bannerCid: '',
      visibility: 'public',
      treasury: '0x0000000000000000000000000000000000000000' as `0x${string}`,
      ceo,
      board,
      governanceParams,
      farcasterChannel: farcasterChannel || undefined,
      websiteUrl: undefined,
      tags,
    }

    createDAOMutation.mutate(draft, {
      onSuccess: (newDAO) => {
        navigate(`/dao/${newDAO.daoId}`)
      },
      onError: (error) => {
        setSubmitError(
          error instanceof Error ? error.message : 'Failed to create DAO',
        )
      },
    })
  }, [
    name,
    displayName,
    description,
    farcasterChannel,
    tags,
    ceo,
    board,
    governanceParams,
    createDAOMutation,
    navigate,
  ])

  const isStepValid = useMemo((): boolean => {
    switch (step) {
      case 'basics':
        return name.trim().length >= 3 && displayName.trim().length >= 2
      case 'ceo':
        return ceo.persona.name.trim().length >= 2
      case 'board':
        return (
          board.length >= 3 &&
          board.every((b) => b.persona.name.trim().length >= 2)
        )
      case 'governance':
        return true
      case 'review':
        return true
      default:
        return false
    }
  }, [step, name, displayName, ceo, board])

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-50 backdrop-blur-xl border-b"
        style={{
          backgroundColor: 'rgba(var(--bg-primary-rgb, 250, 251, 255), 0.95)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="container mx-auto py-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-2 transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Cancel
            </Link>
            <h1
              className="text-lg font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              Create DAO
            </h1>
            <div className="w-20" />
          </div>
        </div>

        {/* Progress Steps */}
        <div className="container mx-auto pb-4">
          <div className="flex items-center justify-between">
            {STEPS.map((s, index) => {
              const Icon = s.icon
              const isCurrent = step === s.id
              const isPast = currentStepIndex > index
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => isPast && setStep(s.id)}
                  disabled={!isPast && !isCurrent}
                  className="flex items-center gap-2 disabled:cursor-not-allowed"
                  style={{
                    color: isCurrent
                      ? 'var(--color-primary)'
                      : isPast
                        ? 'var(--color-success)'
                        : 'var(--text-tertiary)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                    style={{
                      backgroundColor: isCurrent
                        ? 'rgba(6, 214, 160, 0.15)'
                        : isPast
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'var(--bg-secondary)',
                      border: isCurrent
                        ? '2px solid var(--color-primary)'
                        : isPast
                          ? '2px solid var(--color-success)'
                          : '2px solid var(--border)',
                    }}
                  >
                    {isPast ? (
                      <Check className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    )}
                  </div>
                  <span className="hidden sm:inline text-sm font-medium">
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto py-8 max-w-2xl pb-32">
        {/* Step: Basics */}
        {step === 'basics' && (
          <div className="space-y-6 animate-in">
            <h2
              className="text-2xl font-bold mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Organization basics
            </h2>

            <div>
              <label
                htmlFor="dao-slug"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Slug / Username
              </label>
              <input
                id="dao-slug"
                type="text"
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                  )
                }
                placeholder="my-dao"
                className="input"
              />
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                /dao/{name || 'your-dao'}
              </p>
            </div>

            <div>
              <label
                htmlFor="dao-display-name"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Display Name
              </label>
              <input
                id="dao-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My DAO"
                className="input"
              />
            </div>

            <div>
              <label
                htmlFor="dao-description"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Description
              </label>
              <textarea
                id="dao-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what your organization does and its goals"
                rows={4}
                className="textarea"
              />
            </div>

            <div>
              <label
                htmlFor="dao-farcaster"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <MessageSquare
                  className="w-4 h-4 inline mr-1"
                  aria-hidden="true"
                />
                Farcaster Channel (optional)
              </label>
              <input
                id="dao-farcaster"
                type="text"
                value={farcasterChannel}
                onChange={(e) => setFarcasterChannel(e.target.value)}
                placeholder="/my-channel"
                className="input"
              />
            </div>

            <div>
              <span
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-primary)' }}
              >
                Tags
              </span>
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                      className="transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="w-3 h-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="Add a tag"
                  className="input flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step: CEO */}
        {step === 'ceo' && (
          <div className="space-y-6 animate-in">
            <h2
              className="text-2xl font-bold mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              CEO configuration
            </h2>

            <AgentForm agent={ceo} onChange={setCeo} isCEO />
          </div>
        )}

        {/* Step: Board */}
        {step === 'board' && (
          <div className="space-y-6 animate-in">
            <h2
              className="text-2xl font-bold mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Board members
            </h2>

            <div className="space-y-4">
              {board.map((agent, index) => (
                <AgentForm
                  key={`board-${agent.role}-${index}`}
                  agent={agent}
                  onChange={(a) => updateBoardMember(index, a)}
                  onRemove={
                    board.length > 3
                      ? () => removeBoardMember(index)
                      : undefined
                  }
                />
              ))}
            </div>

            <button
              type="button"
              onClick={addBoardMember}
              className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-xl transition-colors"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--text-tertiary)',
              }}
            >
              <Plus className="w-5 h-5" aria-hidden="true" />
              Add Board Member
            </button>
          </div>
        )}

        {/* Step: Governance */}
        {step === 'governance' && (
          <div className="space-y-6 animate-in">
            <h2
              className="text-2xl font-bold mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Governance rules
            </h2>

            <div
              className="rounded-xl p-5 space-y-4"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="min-quality-score"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Min Quality Score
                  </label>
                  <input
                    id="min-quality-score"
                    type="number"
                    min="0"
                    max="100"
                    value={governanceParams.minQualityScore}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        minQualityScore: Number.parseInt(e.target.value, 10),
                      })
                    }
                    className="input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="min-board-approvals"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Min Board Approvals
                  </label>
                  <input
                    id="min-board-approvals"
                    type="number"
                    min="1"
                    max={board.length}
                    value={governanceParams.minBoardApprovals}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        minBoardApprovals: Number.parseInt(e.target.value, 10),
                      })
                    }
                    className="input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="voting-period"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Voting Period (days)
                  </label>
                  <input
                    id="voting-period"
                    type="number"
                    min="1"
                    max="30"
                    value={governanceParams.councilVotingPeriod / 86400}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        councilVotingPeriod:
                          Number.parseInt(e.target.value, 10) * 86400,
                      })
                    }
                    className="input"
                  />
                </div>
                <div>
                  <label
                    htmlFor="min-proposal-stake"
                    className="block text-sm font-medium mb-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    Min Proposal Stake (ETH)
                  </label>
                  <input
                    id="min-proposal-stake"
                    type="text"
                    value={governanceParams.minProposalStake}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        minProposalStake: e.target.value,
                      })
                    }
                    className="input"
                  />
                </div>
              </div>

              <div
                className="pt-4 border-t space-y-3"
                style={{ borderColor: 'var(--border)' }}
              >
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={governanceParams.ceoVetoEnabled}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        ceoVetoEnabled: e.target.checked,
                      })
                    }
                    className="w-5 h-5 rounded accent-[var(--color-primary)]"
                  />
                  <span style={{ color: 'var(--text-primary)' }}>
                    Enable CEO Veto Power
                  </span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={governanceParams.communityVetoEnabled}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        communityVetoEnabled: e.target.checked,
                      })
                    }
                    className="w-5 h-5 rounded accent-[var(--color-primary)]"
                  />
                  <span style={{ color: 'var(--text-primary)' }}>
                    Enable Community Veto ({governanceParams.vetoThreshold}%
                    threshold)
                  </span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Step: Review */}
        {step === 'review' && (
          <div className="space-y-6 animate-in">
            <h2
              className="text-2xl font-bold mb-6"
              style={{ color: 'var(--text-primary)' }}
            >
              Review configuration
            </h2>

            {/* Summary Card */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              {/* DAO Info */}
              <div
                className="p-5 border-b"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold text-white"
                    style={{ background: 'var(--gradient-secondary)' }}
                  >
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3
                      className="text-xl font-bold"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {displayName}
                    </h3>
                    <p style={{ color: 'var(--text-tertiary)' }}>@{name}</p>
                  </div>
                </div>
                <p
                  className="mt-3 text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {description}
                </p>
                {farcasterChannel && (
                  <p
                    className="mt-2 text-sm"
                    style={{ color: 'var(--color-secondary)' }}
                  >
                    <MessageSquare
                      className="w-4 h-4 inline mr-1"
                      aria-hidden="true"
                    />
                    {farcasterChannel}
                  </p>
                )}
              </div>

              {/* CEO */}
              <div
                className="p-5 border-b"
                style={{ borderColor: 'var(--border)' }}
              >
                <h4
                  className="text-sm font-medium uppercase tracking-wider mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  CEO
                </h4>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--gradient-accent)' }}
                  >
                    <Crown className="w-5 h-5 text-white" aria-hidden="true" />
                  </div>
                  <div>
                    <p
                      className="font-medium"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {ceo.persona.name}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {MODEL_OPTIONS.find((m) => m.id === ceo.modelId)?.name} ·{' '}
                      {ceo.decisionStyle}
                    </p>
                  </div>
                </div>
              </div>

              {/* Board */}
              <div
                className="p-5 border-b"
                style={{ borderColor: 'var(--border)' }}
              >
                <h4
                  className="text-sm font-medium uppercase tracking-wider mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Board ({board.length} members)
                </h4>
                <div className="space-y-2">
                  {board.map((member, index) => (
                    <div
                      key={`review-${member.role}-${index}`}
                      className="flex items-center gap-3"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: 'var(--gradient-secondary)' }}
                      >
                        <Bot
                          className="w-4 h-4 text-white"
                          aria-hidden="true"
                        />
                      </div>
                      <div>
                        <p
                          className="text-sm font-medium"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {member.persona.name}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {member.role} · {member.weight}% weight
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Governance */}
              <div className="p-5">
                <h4
                  className="text-sm font-medium uppercase tracking-wider mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Governance
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p style={{ color: 'var(--text-tertiary)' }}>Min Quality</p>
                    <p style={{ color: 'var(--text-primary)' }}>
                      {governanceParams.minQualityScore}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-tertiary)' }}>
                      Board Approvals
                    </p>
                    <p style={{ color: 'var(--text-primary)' }}>
                      {governanceParams.minBoardApprovals} required
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-tertiary)' }}>
                      Voting Period
                    </p>
                    <p style={{ color: 'var(--text-primary)' }}>
                      {governanceParams.councilVotingPeriod / 86400} days
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--text-tertiary)' }}>CEO Veto</p>
                    <p style={{ color: 'var(--text-primary)' }}>
                      {governanceParams.ceoVetoEnabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer Navigation */}
      <footer
        className="fixed bottom-0 left-0 right-0 backdrop-blur-xl border-t"
        style={{
          backgroundColor: 'rgba(var(--bg-primary-rgb, 250, 251, 255), 0.95)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="container mx-auto py-4 max-w-2xl flex justify-between">
          <button
            type="button"
            onClick={goPrev}
            disabled={currentStepIndex === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>

          {step === 'review' ? (
            <div className="flex items-center gap-4">
              {submitError && (
                <div
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--color-error)' }}
                >
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  {submitError}
                </div>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={createDAOMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: 'var(--gradient-primary)' }}
              >
                {createDAOMutation.isPending ? (
                  <>
                    <Loader2
                      className="w-4 h-4 animate-spin"
                      aria-hidden="true"
                    />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                    Launch DAO
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!isStepValid}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Continue
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
