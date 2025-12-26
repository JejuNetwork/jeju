/**
 * Create DAO Wizard
 *
 * Multi-step wizard for creating a new AI-powered DAO with CEO and board configuration.
 */

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Crown,
  Heart,
  Loader2,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useState } from 'react'
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

  const updatePersona = (updates: Partial<CreateAgentDraft['persona']>) => {
    onChange({ ...agent, persona: { ...agent.persona, ...updates } })
  }

  const updateValue = (index: number, value: string) => {
    const newValues = [...agent.values]
    newValues[index] = value
    onChange({ ...agent, values: newValues })
  }

  const addValue = () => {
    onChange({ ...agent, values: [...agent.values, ''] })
  }

  const removeValue = (index: number) => {
    onChange({ ...agent, values: agent.values.filter((_, i) => i !== index) })
  }

  const addTrait = (trait: string) => {
    if (trait && !agent.persona.traits.includes(trait)) {
      updatePersona({ traits: [...agent.persona.traits, trait] })
    }
  }

  const removeTrait = (trait: string) => {
    updatePersona({ traits: agent.persona.traits.filter((t) => t !== trait) })
  }

  return (
    <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isCEO
                ? 'bg-gradient-to-br from-violet-500 to-pink-500'
                : 'bg-slate-700'
            }`}
          >
            {isCEO ? (
              <Crown className="w-5 h-5 text-white" />
            ) : (
              <Bot className="w-5 h-5 text-slate-300" />
            )}
          </div>
          <div className="text-left">
            <p className="font-medium text-slate-200">
              {agent.persona.name || (isCEO ? 'CEO' : preset.name)}
            </p>
            <p className="text-xs text-slate-500">
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
              className="p-2 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-slate-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-500" />
          )}
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div className="p-4 pt-0 space-y-4 border-t border-slate-800">
          {/* Role Selection (for non-CEO) */}
          {!isCEO && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Role
              </label>
              <select
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
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
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
                  className="mt-2 w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                />
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Agent Name
            </label>
            <input
              type="text"
              value={agent.persona.name}
              onChange={(e) => updatePersona({ name: e.target.value })}
              placeholder={
                isCEO ? 'e.g., Eliza, Atlas' : `e.g., ${preset.name}`
              }
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Bio
            </label>
            <textarea
              value={agent.persona.bio}
              onChange={(e) => updatePersona({ bio: e.target.value })}
              placeholder="Brief description of this agent's purpose and focus"
              rows={2}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>

          {/* Personality */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Personality
            </label>
            <textarea
              value={agent.persona.personality}
              onChange={(e) => updatePersona({ personality: e.target.value })}
              placeholder="Describe the agent's personality traits and approach"
              rows={2}
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              AI Model
            </label>
            <div className="grid grid-cols-2 gap-2">
              {MODEL_OPTIONS.map((model) => {
                const isSelected = agent.modelId === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onChange({ ...agent, modelId: model.id })}
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
                    <p className="text-xs text-slate-500">{model.provider}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Decision Style */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Decision Style
            </label>
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

          {/* Communication Tone */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Communication Tone
            </label>
            <select
              value={agent.persona.communicationTone}
              onChange={(e) =>
                updatePersona({
                  communicationTone: e.target.value as CommunicationTone,
                })
              }
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
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
            <label className="block text-sm font-medium text-slate-300 mb-2">
              <Heart className="w-4 h-4 inline mr-1" />
              Core Values
            </label>
            <div className="space-y-2">
              {agent.values.map((value, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => updateValue(index, e.target.value)}
                    placeholder="e.g., Security is paramount"
                    className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                  />
                  {agent.values.length > 1 && (
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
          </div>

          {/* Weight (for non-CEO) */}
          {!isCEO && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Voting Weight ({agent.weight}%)
              </label>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={agent.weight}
                onChange={(e) =>
                  onChange({
                    ...agent,
                    weight: Number.parseInt(e.target.value),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-500">
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

  const currentStepIndex = STEPS.findIndex((s) => s.id === step)

  const goNext = () => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex].id)
    }
  }

  const goPrev = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex].id)
    }
  }

  const addBoardMember = () => {
    setBoard([...board, createBoardMember('CUSTOM')])
  }

  const removeBoardMember = (index: number) => {
    if (board.length > 3) {
      setBoard(board.filter((_, i) => i !== index))
    }
  }

  const updateBoardMember = (index: number, agent: CreateAgentDraft) => {
    const newBoard = [...board]
    newBoard[index] = agent
    setBoard(newBoard)
  }

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()])
      setTagInput('')
    }
  }

  const handleSubmit = async () => {
    setSubmitError(null)

    // Treasury will be deployed by the backend as part of DAO creation
    // We don't need to provide an address - the backend handles this
    const draft: CreateDAODraft = {
      name,
      displayName,
      description,
      avatarCid: '',
      bannerCid: '',
      visibility: 'public',
      treasury: '0x0000000000000000000000000000000000000000' as `0x${string}`, // Placeholder - backend deploys actual treasury
      ceo,
      board,
      governanceParams,
      farcasterChannel: farcasterChannel || undefined,
      websiteUrl: undefined,
      tags,
    }

    createDAOMutation.mutate(draft, {
      onSuccess: (newDAO) => {
        // Navigate to the newly created DAO
        navigate(`/dao/${newDAO.daoId}`)
      },
      onError: (error) => {
        setSubmitError(
          error instanceof Error ? error.message : 'Failed to create DAO',
        )
      },
    })
  }

  const isStepValid = (): boolean => {
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
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Cancel
            </Link>
            <h1 className="text-lg font-semibold text-white">Create DAO</h1>
            <div className="w-20" />
          </div>
        </div>

        {/* Progress Steps */}
        <div className="container mx-auto px-4 pb-4">
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
                  className={`flex items-center gap-2 ${
                    isCurrent
                      ? 'text-violet-400'
                      : isPast
                        ? 'text-slate-400 cursor-pointer hover:text-slate-200'
                        : 'text-slate-600 cursor-not-allowed'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isCurrent
                        ? 'bg-violet-500/20 border border-violet-500'
                        : isPast
                          ? 'bg-emerald-500/20 border border-emerald-500'
                          : 'bg-slate-800 border border-slate-700'
                    }`}
                  >
                    {isPast ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <span className="hidden sm:inline text-sm">{s.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Step: Basics */}
        {step === 'basics' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">DAO Basics</h2>
              <p className="text-slate-400">
                Set up the fundamental identity of your DAO.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Slug / Username
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                  )
                }
                placeholder="my-dao"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Used in URLs: autocrat.jejunetwork.org/dao/{name || 'my-dao'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My DAO"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does your DAO do? What is its mission?"
                rows={4}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <MessageSquare className="w-4 h-4 inline mr-1" />
                Farcaster Channel (optional)
              </label>
              <input
                type="text"
                value={farcasterChannel}
                onChange={(e) => setFarcasterChannel(e.target.value)}
                placeholder="/my-channel"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              <p className="text-xs text-slate-500 mt-1">
                Link to an existing channel or we'll create one for your DAO
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Tags
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 text-slate-300 rounded-lg text-sm"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
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
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  placeholder="Add a tag"
                  className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 text-sm"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step: CEO */}
        {step === 'ceo' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Configure CEO
              </h2>
              <p className="text-slate-400">
                The CEO is the final decision maker for your DAO. Configure
                their personality, values, and decision-making style.
              </p>
            </div>

            <AgentForm agent={ceo} onChange={setCeo} isCEO />
          </div>
        )}

        {/* Step: Board */}
        {step === 'board' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Configure Board
              </h2>
              <p className="text-slate-400">
                Board members review proposals before they reach the CEO.
                Minimum 3 members required.
              </p>
            </div>

            <div className="space-y-4">
              {board.map((agent, index) => (
                <AgentForm
                  key={index}
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
              className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-700 rounded-xl text-slate-400 hover:border-violet-500/50 hover:text-violet-400 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Board Member
            </button>
          </div>
        )}

        {/* Step: Governance */}
        {step === 'governance' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Governance Parameters
              </h2>
              <p className="text-slate-400">
                Configure how proposals are evaluated and approved.
              </p>
            </div>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Min Quality Score
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={governanceParams.minQualityScore}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        minQualityScore: Number.parseInt(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Min Board Approvals
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={board.length}
                    value={governanceParams.minBoardApprovals}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        minBoardApprovals: Number.parseInt(e.target.value),
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Voting Period (days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={governanceParams.councilVotingPeriod / 86400}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        councilVotingPeriod:
                          Number.parseInt(e.target.value) * 86400,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Min Proposal Stake (ETH)
                  </label>
                  <input
                    type="text"
                    value={governanceParams.minProposalStake}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        minProposalStake: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-700 space-y-3">
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
                    className="w-5 h-5 rounded bg-slate-800 border-slate-600 text-violet-500 focus:ring-violet-500"
                  />
                  <span className="text-slate-300">Enable CEO Veto Power</span>
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
                    className="w-5 h-5 rounded bg-slate-800 border-slate-600 text-violet-500 focus:ring-violet-500"
                  />
                  <span className="text-slate-300">
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
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                Review & Create
              </h2>
              <p className="text-slate-400">
                Review your DAO configuration before creating it.
              </p>
            </div>

            {/* Summary Card */}
            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl overflow-hidden">
              {/* DAO Info */}
              <div className="p-5 border-b border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center text-2xl font-bold text-white">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">
                      {displayName}
                    </h3>
                    <p className="text-slate-500">@{name}</p>
                  </div>
                </div>
                <p className="mt-3 text-slate-400 text-sm">{description}</p>
                {farcasterChannel && (
                  <p className="mt-2 text-sm text-violet-400">
                    <MessageSquare className="w-4 h-4 inline mr-1" />
                    {farcasterChannel}
                  </p>
                )}
              </div>

              {/* CEO */}
              <div className="p-5 border-b border-slate-800">
                <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
                  CEO
                </h4>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
                    <Crown className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-200">
                      {ceo.persona.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {MODEL_OPTIONS.find((m) => m.id === ceo.modelId)?.name} •{' '}
                      {ceo.decisionStyle}
                    </p>
                  </div>
                </div>
              </div>

              {/* Board */}
              <div className="p-5 border-b border-slate-800">
                <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
                  Board ({board.length} members)
                </h4>
                <div className="space-y-2">
                  {board.map((member, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-slate-300" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {member.persona.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {member.role} • {member.weight}% weight
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Governance */}
              <div className="p-5">
                <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
                  Governance
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Min Quality</p>
                    <p className="text-slate-200">
                      {governanceParams.minQualityScore}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Board Approvals</p>
                    <p className="text-slate-200">
                      {governanceParams.minBoardApprovals} required
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Voting Period</p>
                    <p className="text-slate-200">
                      {governanceParams.councilVotingPeriod / 86400} days
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">CEO Veto</p>
                    <p className="text-slate-200">
                      {governanceParams.ceoVetoEnabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 bg-violet-500/10 border border-violet-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <Coins className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-violet-300">Funding</h4>
                  <p className="text-sm text-violet-200/70 mt-1">
                    Your DAO will pay for AI inference costs from its treasury.
                    Make sure to fund your treasury after creation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800">
        <div className="container mx-auto px-4 py-4 max-w-2xl flex justify-between">
          <button
            type="button"
            onClick={goPrev}
            disabled={currentStepIndex === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-xl font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          {step === 'review' ? (
            <div className="flex items-center gap-4">
              {submitError && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {submitError}
                </div>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={createDAOMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 text-white rounded-xl font-medium transition-colors"
              >
                {createDAOMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Create DAO
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!isStepValid()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
