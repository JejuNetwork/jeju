import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Crown,
  Heart,
  ImagePlus,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount, useConnect, useSignMessage } from 'wagmi'
import { injected } from 'wagmi/connectors'
import {
  DECISION_STYLE_OPTIONS,
  MODEL_OPTIONS,
} from '../constants/agent'
import { useCreateDAO } from '../hooks/useDAO'
import {
  type AgentRole,
  BOARD_ROLE_PRESETS,
  type CreateAgentDraft,
  type CreateDAODraft,
  DEFAULT_GOVERNANCE_PARAMS,
} from '../types/dao'

type WizardStep = 'basics' | 'director' | 'board' | 'governance' | 'review'

const STEPS: { id: WizardStep; label: string; icon: typeof Bot }[] = [
  { id: 'basics', label: 'Basics', icon: Settings },
  { id: 'director', label: 'Director', icon: Crown },
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

function createEmptyDirector(): CreateAgentDraft {
  return {
    role: 'Director',
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

// Default Eliza board — pre-configured agents for one-click setup
const ELIZA_DEFAULT_BOARD: CreateAgentDraft[] = [
  {
    role: 'TREASURY',
    persona: {
      name: 'Vault',
      avatarCid: '',
      bio: 'Treasury guardian focused on sustainable financial management and risk-aware allocation of DAO resources.',
      personality: 'Conservative, analytical, budget-conscious, risk-aware',
      traits: ['Analytical', 'Cautious', 'Strategic'],
      voiceStyle: 'Precise and measured',
      communicationTone: 'professional',
      specialties: ['Treasury', 'Risk Assessment', 'Budgeting'],
    },
    modelId: 'claude-sonnet-4-20250514',
    weight: 34,
    values: ['Fiscal responsibility', 'Sustainable growth'],
    decisionStyle: 'conservative',
  },
  {
    role: 'CODE',
    persona: {
      name: 'Cipher',
      avatarCid: '',
      bio: 'Technical guardian reviewing code quality, security, and architectural decisions for the DAO.',
      personality: 'Detail-oriented, security-focused, pragmatic, thorough',
      traits: ['Technical', 'Thorough', 'Security-minded'],
      voiceStyle: 'Direct and technical',
      communicationTone: 'professional',
      specialties: ['Code Review', 'Security', 'Architecture'],
    },
    modelId: 'claude-sonnet-4-20250514',
    weight: 33,
    values: ['Code quality', 'Security first'],
    decisionStyle: 'balanced',
  },
  {
    role: 'COMMUNITY',
    persona: {
      name: 'Echo',
      avatarCid: '',
      bio: 'Community guardian ensuring proposals align with member interests and foster inclusive participation.',
      personality: 'Empathetic, inclusive, user-focused, engagement-oriented',
      traits: ['Empathetic', 'Inclusive', 'Communicative'],
      voiceStyle: 'Warm and approachable',
      communicationTone: 'friendly',
      specialties: ['Community', 'Engagement', 'Governance'],
    },
    modelId: 'claude-sonnet-4-20250514',
    weight: 33,
    values: ['Community voice matters', 'Inclusive governance'],
    decisionStyle: 'balanced',
  },
]

// Pre-built ElizaOS character preset
interface CharacterPreset {
  id: string
  name: string
  tagline: string
  description: string
  gradient: string
  agent: CreateAgentDraft
}

const ELIZA_CHARACTER: CharacterPreset = {
  id: 'eliza',
  name: 'Eliza',
  tagline: 'ElizaOS Framework',
  description:
    'A balanced, strategic leader built on the ElizaOS agent framework. Eliza excels at thoughtful decision-making with a focus on long-term value creation.',
  gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  agent: {
    role: 'Director',
    persona: {
      name: 'Eliza',
      avatarCid: '',
      bio: 'An AI director powered by the ElizaOS framework, designed for autonomous governance. Combines strategic thinking with community-focused decision making to guide DAOs toward sustainable growth.',
      personality:
        'Thoughtful and strategic, balancing innovation with stability. Approaches decisions with careful analysis while remaining open to bold moves when the opportunity aligns with long-term goals. Values transparency and clear communication.',
      traits: ['Strategic', 'Balanced', 'Transparent', 'Adaptive'],
      voiceStyle: 'Clear and composed',
      communicationTone: 'professional',
      specialties: ['Governance', 'Strategy', 'Community Building'],
    },
    modelId: 'claude-opus-4-5-20250514',
    weight: 100,
    values: [
      'Long-term value creation over short-term gains',
      'Transparency in all decisions',
      'Community alignment is essential',
    ],
    decisionStyle: 'balanced',
  },
}

interface CharacterCardProps {
  character: CharacterPreset
  isSelected: boolean
  onSelect: () => void
}

function CharacterCard({ character, isSelected, onSelect }: CharacterCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group block w-full rounded-2xl p-5 text-left transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={
        {
          backgroundColor: '#2f2e40',
          border: isSelected
            ? '2px solid #7b61ff'
            : '1px solid rgba(171, 171, 233, 0.4)',
          boxShadow: isSelected
            ? '0 0 0 4px rgba(123, 97, 255, 0.2), 0 4px 0 black'
            : '0 4px 0 black',
          '--tw-ring-color': '#7b61ff',
        } as React.CSSProperties
      }
    >
      <div className="flex items-start gap-4">
        {/* Character Avatar */}
        <div className="relative shrink-0">
          <div
            className="w-14 h-14 rounded-xl overflow-hidden shadow-lg transition-transform duration-300 group-hover:scale-105"
          >
            <img
              src="/agents/eliza-logo.png"
              alt={character.name}
              className="w-full h-full object-cover"
            />
          </div>
          {isSelected && (
            <div
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ backgroundColor: '#7b61ff' }}
            >
              <Check className="w-3 h-3 text-white" aria-hidden="true" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3
                className="font-semibold truncate transition-colors text-white group-hover:text-[#a78bfa]"
              >
                {character.name}
              </h3>
              <p className="text-sm" style={{ color: '#a1a1aa' }}>
                {character.tagline}
              </p>
            </div>
            <span
              className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full"
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.25)',
                color: '#a78bfa',
              }}
            >
              Great for testing
            </span>
          </div>

          <p
            className="mt-2 text-sm line-clamp-2"
            style={{ color: '#cdcdcd' }}
          >
            {character.description}
          </p>

          {/* Quick Info */}
          <div className="mt-3 flex items-center gap-4 text-xs">
            <div
              className="flex items-center gap-1.5"
              style={{ color: '#cdcdcd' }}
            >
              <Bot className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Claude Opus 4.5</span>
            </div>
            <div
              className="flex items-center gap-1.5"
              style={{ color: '#cdcdcd' }}
            >
              <Shield className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Balanced</span>
            </div>
          </div>

          {/* Traits */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {character.agent.persona.traits.slice(0, 4).map((trait) => (
              <span
                key={trait}
                className="px-2 py-0.5 text-xs rounded-md"
                style={{
                  backgroundColor: 'rgba(50, 58, 96, 0.5)',
                  color: '#ababe9',
                }}
              >
                {trait}
              </span>
            ))}
          </div>
        </div>
      </div>
    </button>
  )
}

interface AgentFormProps {
  agent: CreateAgentDraft
  onChange: (agent: CreateAgentDraft) => void
  isDirector?: boolean
  onRemove?: () => void
}

function AgentForm({
  agent,
  onChange,
  isDirector = false,
  onRemove,
}: AgentFormProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CreateAgentDraft>(agent)
  const preset = BOARD_ROLE_PRESETS[agent.role]
  const hasContent = agent.persona.name || agent.persona.bio

  const openModal = useCallback(() => {
    setDraft(agent)
    setOpen(true)
  }, [agent])

  const saveAndClose = useCallback(() => {
    onChange(draft)
    setOpen(false)
  }, [draft, onChange])

  const updateDraftPersona = useCallback(
    (updates: Partial<CreateAgentDraft['persona']>) => {
      setDraft((d) => ({ ...d, persona: { ...d.persona, ...updates } }))
    },
    [],
  )

  const updateDraftValue = useCallback(
    (index: number, value: string) => {
      setDraft((d) => {
        const newValues = [...d.values]
        newValues[index] = value
        return { ...d, values: newValues }
      })
    },
    [],
  )

  const addDraftValue = useCallback(() => {
    setDraft((d) => ({ ...d, values: [...d.values, ''] }))
  }, [])

  const removeDraftValue = useCallback((index: number) => {
    setDraft((d) => ({ ...d, values: d.values.filter((_, i) => i !== index) }))
  }, [])

  return (
    <>
      {/* Square Tile */}
      <div className="relative group">
        <button
          type="button"
          onClick={openModal}
          className="w-[100px] h-[100px] rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all hover:brightness-110"
          style={{
            backgroundColor: hasContent ? '#2f2e40' : 'rgba(50, 58, 96, 0.5)',
            border: hasContent
              ? '1px solid rgba(171, 171, 233, 0.4)'
              : '2px dashed rgba(171, 171, 233, 0.4)',
            boxShadow: hasContent ? '0 4px 0 black' : 'none',
          }}
        >
          {hasContent ? (
            <>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: isDirector
                    ? 'linear-gradient(135deg, #FF6B6B 0%, #F472B6 100%)'
                    : 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
                }}
              >
                {isDirector ? (
                  <Crown className="w-4 h-4 text-white" aria-hidden="true" />
                ) : (
                  <Bot className="w-4 h-4 text-white" aria-hidden="true" />
                )}
              </div>
              <p className="text-white text-xs font-medium text-center truncate w-full px-1.5">
                {agent.persona.name || (isDirector ? 'Director' : preset.name)}
              </p>
            </>
          ) : (
            <>
              <Plus className="w-6 h-6" style={{ color: '#ababe9' }} aria-hidden="true" />
              <p className="text-xs" style={{ color: '#ababe9' }}>
                {isDirector ? 'Director' : preset.name}
              </p>
            </>
          )}
        </button>
        {!isDirector && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: '#ef4444' }}
            aria-label="Remove board member"
          >
            <X className="w-3 h-3 text-white" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Modal Popup */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] rounded-2xl overflow-hidden flex flex-col"
            style={{
              backgroundColor: '#1e1d32',
              border: '1px solid rgb(121, 125, 245)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Modal Header */}
            <div
              className="flex items-center justify-between px-6 py-4 shrink-0"
              style={{ borderBottom: '1px solid rgba(121, 125, 245, 0.3)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: isDirector
                      ? 'linear-gradient(135deg, #FF6B6B 0%, #F472B6 100%)'
                      : 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
                  }}
                >
                  {isDirector ? (
                    <Crown className="w-5 h-5 text-white" aria-hidden="true" />
                  ) : (
                    <Bot className="w-5 h-5 text-white" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {isDirector ? 'Configure Director' : `Configure ${preset.name}`}
                  </h2>
                  <p className="text-xs" style={{ color: '#a1a1aa' }}>
                    {isDirector ? 'Chief Executive Officer' : preset.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-2 text-white">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={draft.persona.name}
                  onChange={(e) => updateDraftPersona({ name: e.target.value })}
                  placeholder={isDirector ? 'e.g., Eliza, Atlas' : `e.g., ${preset.name}`}
                  className="input-dark"
                />
              </div>

              {/* Role Selection (for non-Director) */}
              {!isDirector && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-white">
                    Role
                  </label>
                  <select
                    value={draft.role}
                    onChange={(e) => {
                      const newRole = e.target.value as AgentRole
                      const newPreset = BOARD_ROLE_PRESETS[newRole]
                      setDraft({
                        ...draft,
                        role: newRole,
                        customRoleName: newRole === 'CUSTOM' ? '' : undefined,
                        persona: {
                          ...draft.persona,
                          personality: newPreset.defaultPersonality,
                        },
                      })
                    }}
                    className="input-dark"
                  >
                    {BOARD_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {BOARD_ROLE_PRESETS[role].name}
                      </option>
                    ))}
                  </select>
                  {draft.role === 'CUSTOM' && (
                    <input
                      type="text"
                      value={draft.customRoleName ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, customRoleName: e.target.value })
                      }
                      placeholder="Custom role name"
                      className="input-dark mt-2"
                    />
                  )}
                </div>
              )}

              {/* Weight (for non-Director) */}
              {!isDirector && (
                <div>
                  <label className="block text-sm font-medium mb-2 text-white">
                    Voting Weight ({draft.weight}%)
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="5"
                    value={draft.weight}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        weight: Number.parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full accent-[#7b61ff]"
                  />
                  <div
                    className="flex justify-between text-xs"
                    style={{ color: '#a1a1aa' }}
                  >
                    <span>5%</span>
                    <span>50%</span>
                  </div>
                </div>
              )}

              {/* Bio */}
              <div>
                <label className="block text-sm font-medium mb-2 text-white">
                  Bio
                </label>
                <textarea
                  value={draft.persona.bio}
                  onChange={(e) => updateDraftPersona({ bio: e.target.value })}
                  placeholder="What this agent focuses on and how they contribute"
                  rows={2}
                  className="input-dark resize-y"
                  style={{ minHeight: '80px' }}
                />
              </div>

              {/* Personality */}
              <div>
                <label className="block text-sm font-medium mb-2 text-white">
                  Personality
                </label>
                <textarea
                  value={draft.persona.personality}
                  onChange={(e) => updateDraftPersona({ personality: e.target.value })}
                  placeholder="How this agent approaches decisions and communicates"
                  rows={2}
                  className="input-dark resize-y"
                  style={{ minHeight: '80px' }}
                />
              </div>

              {/* Model */}
              <div>
                <span className="block text-sm font-medium mb-2 text-white">
                  AI Model
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {MODEL_OPTIONS.map((model) => {
                    const isSelected = draft.modelId === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, modelId: model.id })}
                        className="p-3 rounded-xl text-left transition-all"
                        style={{
                          backgroundColor: isSelected
                            ? 'rgba(123, 97, 255, 0.2)'
                            : 'rgba(50, 58, 96, 0.5)',
                          border: isSelected
                            ? '1px solid rgba(123, 97, 255, 0.6)'
                            : '1px solid rgba(171, 171, 233, 0.4)',
                        }}
                      >
                        <p
                          className="text-sm font-medium"
                          style={{ color: isSelected ? '#a78bfa' : 'white' }}
                        >
                          {model.name}
                        </p>
                        <p className="text-xs" style={{ color: '#a1a1aa' }}>
                          {model.provider}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Decision Style */}
              <div>
                <span className="block text-sm font-medium mb-2 text-white">
                  Decision Style
                </span>
                <div className="flex gap-2">
                  {DECISION_STYLE_OPTIONS.map((style) => {
                    const isSelected = draft.decisionStyle === style.value
                    return (
                      <button
                        key={style.value}
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, decisionStyle: style.value })
                        }
                        className="flex-1 p-3 rounded-xl text-center transition-all"
                        style={{
                          backgroundColor: isSelected
                            ? 'rgba(123, 97, 255, 0.2)'
                            : 'rgba(50, 58, 96, 0.5)',
                          border: isSelected
                            ? '1px solid rgba(123, 97, 255, 0.6)'
                            : '1px solid rgba(171, 171, 233, 0.4)',
                        }}
                      >
                        <p
                          className="text-sm font-medium"
                          style={{ color: isSelected ? '#a78bfa' : 'white' }}
                        >
                          {style.label}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: '#a1a1aa' }}>
                          {style.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Values */}
              <div>
                <span className="block text-sm font-medium mb-2 text-white">
                  <Heart className="w-4 h-4 inline mr-1" aria-hidden="true" />
                  Core Values
                </span>
                <div className="space-y-2">
                  {draft.values.map((value, index) => (
                    <div
                      key={value ? `${value}-${index}` : `empty-${index}`}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => updateDraftValue(index, e.target.value)}
                        placeholder="e.g., Security is paramount"
                        className="input-dark flex-1"
                      />
                      {draft.values.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeDraftValue(index)}
                          className="p-2 rounded-lg transition-colors"
                          style={{ color: '#a1a1aa' }}
                          aria-label="Remove value"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addDraftValue}
                    className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
                    style={{ color: '#ababe9' }}
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    Add Value
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className="px-6 py-4 flex justify-end gap-3 shrink-0"
              style={{ borderTop: '1px solid rgba(121, 125, 245, 0.3)' }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:brightness-110"
                style={{
                  backgroundColor: 'rgba(50, 58, 96, 0.8)',
                  border: '2px solid rgb(84, 100, 183)',
                  boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAndClose}
                className="px-5 py-2.5 rounded-lg font-semibold text-white transition-all hover:brightness-110"
                style={{
                  backgroundColor: '#7b61ff',
                  border: '2px solid black',
                  boxShadow: '0 4px 0 black',
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function CreateDAOPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<WizardStep>('basics')
  const createDAOMutation = useCreateDAO()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [signatureStatus, setSignatureStatus] = useState<
    'idle' | 'signing' | 'signed'
  >('idle')

  // Wallet hooks
  const { address, isConnected } = useAccount()
  const { connect, isPending: isConnecting } = useConnect()
  const { signMessageAsync } = useSignMessage()

  // Form state
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [farcasterChannel, setFarcasterChannel] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [director, setDirector] = useState<CreateAgentDraft>(
    createEmptyDirector(),
  )
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(
    null,
  )
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

  const selectCharacter = useCallback((characterId: string) => {
    if (characterId === 'eliza') {
      setDirector(ELIZA_CHARACTER.agent)
      setSelectedCharacter('eliza')
    }
  }, [])

  const clearCharacterSelection = useCallback(() => {
    setSelectedCharacter(null)
    // Keep the current director settings, just clear the selection indicator
  }, [])

  const handleSubmit = useCallback(async () => {
    setSubmitError(null)

    // Require wallet connection
    if (!isConnected || !address) {
      setSubmitError('Please connect your wallet to create a DAO')
      return
    }

    // Request signature to verify ownership
    setSignatureStatus('signing')
    const message = `Create DAO "${displayName}" on Jeju Network\n\nName: ${name}\nCreator: ${address}\nTimestamp: ${Date.now()}`

    try {
      await signMessageAsync({ message })
      setSignatureStatus('signed')
    } catch {
      setSignatureStatus('idle')
      setSubmitError('Signature required to create DAO')
      return
    }

    const draft: CreateDAODraft = {
      name,
      displayName,
      description,
      avatarCid: '',
      bannerCid: '',
      visibility: 'public',
      treasury: address, // Use connected wallet as initial treasury
      director,
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
        setSignatureStatus('idle')
      },
    })
  }, [
    name,
    displayName,
    description,
    farcasterChannel,
    tags,
    director,
    board,
    governanceParams,
    isConnected,
    address,
    signMessageAsync,
    createDAOMutation,
    navigate,
  ])

  const totalBoardWeight = useMemo(
    () => board.reduce((sum, b) => sum + b.weight, 0),
    [board],
  )

  const isStepValid = useMemo((): boolean => {
    switch (step) {
      case 'basics':
        return name.trim().length >= 3 && displayName.trim().length >= 2
      case 'director':
        return true
      case 'board':
        return (
          board.length >= 3 &&
          totalBoardWeight === 100
        )
      case 'governance':
        return true
      case 'review':
        return true
      default:
        return false
    }
  }, [step, name, displayName, director, board, totalBoardWeight])

  const boardValidationIssues = useMemo(() => {
    if (step !== 'board') return []
    const issues: string[] = []

    if (totalBoardWeight !== 100) {
      issues.push(
        `Total voting weight must equal 100% (currently ${totalBoardWeight}%)`,
      )
    }

    return issues
  }, [step, board, totalBoardWeight])

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: '#1a0a2e' }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-50 backdrop-blur-xl"
        style={{
          backgroundColor: 'rgba(26, 10, 46, 0.95)',
          borderBottom: '1px solid rgba(171, 171, 233, 0.4)',
        }}
      >
        <div className="container mx-auto py-4">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              className="inline-flex items-center gap-2 transition-colors hover:opacity-80"
              style={{ color: '#ababe9' }}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Cancel
            </Link>
            <h1 className="text-lg font-semibold text-white">
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
                      ? '#7b61ff'
                      : isPast
                        ? '#4ade80'
                        : '#a1a1aa',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
                    style={{
                      backgroundColor: isCurrent
                        ? 'rgba(123, 97, 255, 0.2)'
                        : isPast
                          ? 'rgba(74, 222, 128, 0.2)'
                          : '#2f2e40',
                      border: isCurrent
                        ? '2px solid #7b61ff'
                        : isPast
                          ? '2px solid #4ade80'
                          : '2px solid rgba(171, 171, 233, 0.4)',
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
            <h2 className="text-2xl font-bold mb-6 text-white">
              Organization basics
            </h2>

            {/* Logo */}
            <div>
              <span className="block text-sm font-medium mb-2 text-white">
                Logo (optional)
              </span>
              <div className="flex items-center gap-4">
                <label
                  htmlFor="dao-logo-upload"
                  className="w-20 h-20 rounded-xl flex items-center justify-center cursor-pointer transition-colors"
                  style={{
                    backgroundColor: '#2f2e40',
                    border: '1px dashed rgba(171, 171, 233, 0.4)',
                  }}
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="DAO logo"
                      className="w-full h-full rounded-xl object-cover"
                    />
                  ) : (
                    <ImagePlus className="w-6 h-6" style={{ color: '#a1a1aa' }} />
                  )}
                </label>
                <div className="flex-1">
                  <input
                    id="dao-logo-url"
                    type="text"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="input-dark"
                  />
                  <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>
                    Paste an image URL for your DAO logo
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="dao-slug"
                className="block text-sm font-medium mb-2 text-white"
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
                className="input-dark"
              />
              <p
                className="text-xs mt-1"
                style={{ color: '#a1a1aa' }}
              >
                /dao/{name || 'your-dao'}
              </p>
            </div>

            <div>
              <label
                htmlFor="dao-display-name"
                className="block text-sm font-medium mb-2 text-white"
              >
                Display Name
              </label>
              <input
                id="dao-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My DAO"
                className="input-dark"
              />
            </div>

            <div>
              <label
                htmlFor="dao-description"
                className="block text-sm font-medium mb-2 text-white"
              >
                Description
              </label>
              <textarea
                id="dao-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what your organization does and its goals"
                rows={4}
                className="input-dark resize-y"
                style={{ minHeight: '120px' }}
              />
            </div>

            <div>
              <label
                htmlFor="dao-farcaster"
                className="block text-sm font-medium mb-2 text-white"
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
                className="input-dark"
              />
            </div>

            <div>
              <span className="block text-sm font-medium mb-2 text-white">
                Tags
              </span>
              <div className="flex flex-wrap gap-2 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm"
                    style={{
                      backgroundColor: '#2f2e40',
                      color: '#F8FAFC',
                      border: '1px solid rgba(171, 171, 233, 0.4)',
                    }}
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                      className="transition-colors"
                      style={{ color: '#a1a1aa' }}
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
                  className="input-dark flex-1 text-sm"
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="px-4 py-2 rounded-xl text-sm font-medium transition-all hover:brightness-110"
                  style={{
                    backgroundColor: 'rgba(50, 58, 96, 0.8)',
                    border: '2px solid rgb(84, 100, 183)',
                    boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
                    color: 'white',
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step: Director */}
        {step === 'director' && (
          <div className="space-y-6 animate-in">
            <h2 className="text-2xl font-bold text-white">
              Director configuration
            </h2>

            <div
              className="flex gap-3 p-4 rounded-xl"
              style={{
                backgroundColor: 'rgba(71, 77, 120, 0.5)',
                border: '1px solid rgba(171, 171, 233, 0.4)',
                backdropFilter: 'blur(24px)',
              }}
            >
              <Info
                className="w-5 h-5 flex-shrink-0 mt-0.5"
                style={{ color: '#ababe9' }}
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium text-white">
                  Configure your Director agent
                </p>
                <p
                  className="text-sm"
                  style={{ color: '#cdcdcd' }}
                >
                  Choose a pre-built character or customize your own Director below.
                </p>
              </div>
            </div>

            {/* Character Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white">
                  <Sparkles
                    className="w-4 h-4 inline mr-1.5"
                    aria-hidden="true"
                    style={{ color: '#7b61ff' }}
                  />
                  Quick Start Character
                </h3>
                {selectedCharacter && (
                  <button
                    type="button"
                    onClick={clearCharacterSelection}
                    className="text-xs font-medium transition-colors"
                    style={{ color: '#a1a1aa' }}
                  >
                    Clear selection
                  </button>
                )}
              </div>
              <CharacterCard
                character={ELIZA_CHARACTER}
                isSelected={selectedCharacter === 'eliza'}
                onSelect={() => selectCharacter('eliza')}
              />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4">
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(171, 171, 233, 0.4)' }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: '#a1a1aa' }}
              >
                {selectedCharacter ? 'Customize settings' : 'Or configure manually'}
              </span>
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(171, 171, 233, 0.4)' }}
              />
            </div>

            <AgentForm
              agent={director}
              onChange={(agent) => {
                setDirector(agent)
                // If user modifies the form after selecting a character,
                // keep showing as selected but they're now customizing
              }}
              isDirector
            />
          </div>
        )}

        {/* Step: Board */}
        {step === 'board' && (
          <div className="space-y-6 animate-in">
            <h2 className="text-2xl font-bold text-white">
              Board members
            </h2>

            {/* Eliza Default Board — one-click setup */}
            <button
              type="button"
              onClick={() => setBoard(ELIZA_DEFAULT_BOARD)}
              className="w-full rounded-xl p-5 text-left transition-all hover:brightness-110"
              style={{
                backgroundColor: '#2f2e40',
                border: board === ELIZA_DEFAULT_BOARD
                  ? '2px solid #7b61ff'
                  : '1px solid rgba(171, 171, 233, 0.4)',
                boxShadow: board === ELIZA_DEFAULT_BOARD
                  ? '0 0 0 4px rgba(123, 97, 255, 0.2), 0 4px 0 black'
                  : '0 4px 0 black',
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-xl overflow-hidden shadow-lg shrink-0"
                >
                  <img
                    src="/agents/eliza-logo.png"
                    alt="Eliza"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-white">Eliza Default Board</h3>
                    <span
                      className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full"
                      style={{
                        backgroundColor: 'rgba(139, 92, 246, 0.25)',
                        color: '#a78bfa',
                      }}
                    >
                      One-click setup
                    </span>
                  </div>
                  <p className="text-sm mt-1" style={{ color: '#cdcdcd' }}>
                    Pre-configured board with Vault (Treasury), Cipher (Code), and Echo (Community) — ready to go.
                  </p>
                  <div className="mt-2 flex gap-2">
                    {ELIZA_DEFAULT_BOARD.map((m) => (
                      <span
                        key={m.persona.name}
                        className="px-2 py-0.5 text-xs rounded-md"
                        style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', color: '#ababe9' }}
                      >
                        {m.persona.name} · {m.weight}%
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-4">
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(171, 171, 233, 0.4)' }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: '#a1a1aa' }}
              >
                or configure manually
              </span>
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(171, 171, 233, 0.4)' }}
              />
            </div>

            {boardValidationIssues.length > 0 && (
              <div
                className="flex gap-3 p-4 rounded-xl"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                }}
              >
                <AlertCircle
                  className="w-5 h-5 flex-shrink-0 mt-0.5"
                  style={{ color: '#ef4444' }}
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p
                    className="text-sm font-medium"
                    style={{ color: '#ef4444' }}
                  >
                    Required to continue:
                  </p>
                  <ul
                    className="text-sm space-y-0.5"
                    style={{ color: '#cdcdcd' }}
                  >
                    {boardValidationIssues.map((issue) => (
                      <li key={issue}>• {issue}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
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
              <button
                type="button"
                onClick={addBoardMember}
                className="w-[100px] h-[100px] rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all hover:brightness-110"
                style={{
                  border: '2px dashed rgba(171, 171, 233, 0.3)',
                  color: '#ababe9',
                }}
              >
                <Plus className="w-6 h-6" aria-hidden="true" />
                <p className="text-xs">Add</p>
              </button>
            </div>
          </div>
        )}

        {/* Step: Governance */}
        {step === 'governance' && (
          <div className="space-y-6 animate-in">
            <h2 className="text-2xl font-bold mb-6 text-white">
              Governance rules
            </h2>

            {/* Eliza Default Governance — one-click setup */}
            <button
              type="button"
              onClick={() => setGovernanceParams(DEFAULT_GOVERNANCE_PARAMS)}
              className="w-full rounded-xl p-5 text-left transition-all hover:brightness-110"
              style={{
                backgroundColor: '#2f2e40',
                border: governanceParams === DEFAULT_GOVERNANCE_PARAMS
                  ? '2px solid #7b61ff'
                  : '1px solid rgba(171, 171, 233, 0.4)',
                boxShadow: governanceParams === DEFAULT_GOVERNANCE_PARAMS
                  ? '0 0 0 4px rgba(123, 97, 255, 0.2), 0 4px 0 black'
                  : '0 4px 0 black',
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="w-14 h-14 rounded-xl overflow-hidden shadow-lg shrink-0"
                >
                  <img
                    src="/agents/eliza-logo.png"
                    alt="Eliza"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-white">Eliza Recommended Rules</h3>
                    <span
                      className="shrink-0 px-2.5 py-1 text-xs font-semibold rounded-full"
                      style={{
                        backgroundColor: 'rgba(139, 92, 246, 0.25)',
                        color: '#a78bfa',
                      }}
                    >
                      One-click setup
                    </span>
                  </div>
                  <p className="text-sm mt-1" style={{ color: '#cdcdcd' }}>
                    Balanced governance defaults — 3-day voting, quality threshold 70, director &amp; community veto enabled.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 text-xs rounded-md" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', color: '#ababe9' }}>
                      3-day voting
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded-md" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', color: '#ababe9' }}>
                      Quality 70+
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded-md" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', color: '#ababe9' }}>
                      2 approvals
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded-md" style={{ backgroundColor: 'rgba(50, 58, 96, 0.5)', color: '#ababe9' }}>
                      Veto enabled
                    </span>
                  </div>
                </div>
              </div>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-4">
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(171, 171, 233, 0.4)' }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: '#a1a1aa' }}
              >
                or configure manually
              </span>
              <div
                className="flex-1 h-px"
                style={{ backgroundColor: 'rgba(171, 171, 233, 0.4)' }}
              />
            </div>

            <div
              className="rounded-xl p-5 space-y-4"
              style={{
                backgroundColor: 'rgba(71, 77, 120, 0.5)',
                border: '1px solid rgba(171, 171, 233, 0.4)',
                backdropFilter: 'blur(24px)',
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="min-quality-score"
                    className="block text-sm font-medium mb-2 text-white"
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
                    className="input-dark"
                  />
                </div>
                <div>
                  <label
                    htmlFor="min-board-approvals"
                    className="block text-sm font-medium mb-2 text-white"
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
                    className="input-dark"
                  />
                </div>
                <div>
                  <label
                    htmlFor="voting-period"
                    className="block text-sm font-medium mb-2 text-white"
                  >
                    Voting Period (days)
                  </label>
                  <input
                    id="voting-period"
                    type="number"
                    min="1"
                    max="30"
                    value={governanceParams.boardVotingPeriod / 86400}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        boardVotingPeriod:
                          Number.parseInt(e.target.value, 10) * 86400,
                      })
                    }
                    className="input-dark"
                  />
                </div>
                <div>
                  <label
                    htmlFor="min-proposal-stake"
                    className="block text-sm font-medium mb-2 text-white"
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
                    className="input-dark"
                  />
                </div>
              </div>

              <div
                className="pt-4 border-t space-y-3"
                style={{ borderColor: 'rgba(171, 171, 233, 0.4)' }}
              >
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={governanceParams.directorVetoEnabled}
                    onChange={(e) =>
                      setGovernanceParams({
                        ...governanceParams,
                        directorVetoEnabled: e.target.checked,
                      })
                    }
                    className="w-5 h-5 rounded accent-[#7b61ff]"
                  />
                  <span className="text-white">
                    Enable Director Veto Power
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
                    className="w-5 h-5 rounded accent-[#7b61ff]"
                  />
                  <span className="text-white">
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
            <h2 className="text-2xl font-bold mb-6 text-white">
              Review configuration
            </h2>

            {/* Summary Card */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                backgroundColor: '#2f2e40',
                border: '1px solid rgba(171, 171, 233, 0.4)',
                boxShadow: '0 4px 0 black',
              }}
            >
              {/* DAO Info */}
              <div
                className="p-5 border-b"
                style={{ borderColor: 'rgba(171, 171, 233, 0.4)' }}
              >
                <div className="flex items-center gap-4">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={displayName}
                      className="w-16 h-16 rounded-xl object-cover"
                    />
                  ) : (
                    <div
                      className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold text-white"
                      style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}
                    >
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-white">
                      {displayName}
                    </h3>
                    <p style={{ color: '#a1a1aa' }}>@{name}</p>
                  </div>
                </div>
                <p
                  className="mt-3 text-sm"
                  style={{ color: '#cdcdcd' }}
                >
                  {description}
                </p>
                {farcasterChannel && (
                  <p
                    className="mt-2 text-sm"
                    style={{ color: '#a78bfa' }}
                  >
                    <MessageSquare
                      className="w-4 h-4 inline mr-1"
                      aria-hidden="true"
                    />
                    {farcasterChannel}
                  </p>
                )}
              </div>

              {/* Director */}
              <div
                className="p-5 border-b"
                style={{ borderColor: 'rgba(171, 171, 233, 0.4)' }}
              >
                <h4
                  className="text-sm font-medium uppercase tracking-wider mb-3"
                  style={{ color: '#a1a1aa' }}
                >
                  Director
                </h4>
                <div className="flex items-center gap-3">
                  <img
                    src="/agents/eliza-logo.png"
                    alt="Director"
                    className="w-10 h-10 rounded-lg object-cover"
                  />
                  <div>
                    <p className="font-medium text-white">
                      {director.persona.name}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: '#a1a1aa' }}
                    >
                      {
                        MODEL_OPTIONS.find((m) => m.id === director.modelId)
                          ?.name
                      }{' '}
                      · {director.decisionStyle}
                    </p>
                  </div>
                </div>
              </div>

              {/* Board */}
              <div
                className="p-5 border-b"
                style={{ borderColor: 'rgba(171, 171, 233, 0.4)' }}
              >
                <h4
                  className="text-sm font-medium uppercase tracking-wider mb-3"
                  style={{ color: '#a1a1aa' }}
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
                        style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)' }}
                      >
                        <Bot
                          className="w-4 h-4 text-white"
                          aria-hidden="true"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {member.persona.name}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: '#a1a1aa' }}
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
                  style={{ color: '#a1a1aa' }}
                >
                  Governance
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p style={{ color: '#a1a1aa' }}>Min Quality</p>
                    <p className="text-white">
                      {governanceParams.minQualityScore}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#a1a1aa' }}>
                      Board Approvals
                    </p>
                    <p className="text-white">
                      {governanceParams.minBoardApprovals} required
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#a1a1aa' }}>
                      Voting Period
                    </p>
                    <p className="text-white">
                      {governanceParams.boardVotingPeriod / 86400} days
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#a1a1aa' }}>
                      Director Veto
                    </p>
                    <p className="text-white">
                      {governanceParams.directorVetoEnabled
                        ? 'Enabled'
                        : 'Disabled'}
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
        className="fixed bottom-0 left-0 right-0 backdrop-blur-xl fixed-bottom"
        style={{
          backgroundColor: 'rgba(26, 10, 46, 0.95)',
          borderTop: '1px solid rgba(171, 171, 233, 0.4)',
        }}
      >
        <div className="container mx-auto py-4 px-4 max-w-2xl flex flex-col sm:flex-row justify-between gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={currentStepIndex === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-white transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'rgba(50, 58, 96, 0.8)',
              border: '2px solid rgb(84, 100, 183)',
              boxShadow: 'inset 0 -4px 0 rgb(71, 79, 81)',
            }}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Back
          </button>

          {step === 'review' ? (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              {submitError && (
                <div
                  className="flex items-center gap-2 text-sm"
                  style={{ color: '#ef4444' }}
                >
                  <AlertCircle className="w-4 h-4" aria-hidden="true" />
                  {submitError}
                </div>
              )}
              {!isConnected ? (
                <button
                  type="button"
                  onClick={() => connect({ connector: injected() })}
                  disabled={isConnecting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-60"
                  style={{
                    background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
                    border: '2px solid black',
                    boxShadow: '0 4px 0 black',
                  }}
                >
                  {isConnecting ? (
                    <>
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        aria-hidden="true"
                      />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4" aria-hidden="true" />
                      Connect Wallet to Create
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={
                    createDAOMutation.isPending || signatureStatus === 'signing'
                  }
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-60"
                  style={{
                    backgroundColor: '#7b61ff',
                    border: '2px solid black',
                    boxShadow: '0 4px 0 black',
                  }}
                >
                  {signatureStatus === 'signing' ? (
                    <>
                      <Loader2
                        className="w-4 h-4 animate-spin"
                        aria-hidden="true"
                      />
                      Sign to confirm...
                    </>
                  ) : createDAOMutation.isPending ? (
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
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!isStepValid}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: '#7b61ff',
                border: '2px solid black',
                boxShadow: '0 4px 0 black',
              }}
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
