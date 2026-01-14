import { useJejuAuth } from '@jejunetwork/auth/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useCharacter, useCharacters, useRegisterAgent } from '../hooks'

interface Capabilities {
  canChat: boolean
  canTrade: boolean
  canVote: boolean
  canPropose: boolean
  canStake: boolean
  a2a: boolean
  compute: boolean
}

interface AutonomousSettings {
  enabled: boolean
  tickIntervalMs: number
}

const CAPABILITY_CONFIG: Record<
  keyof Capabilities,
  { icon: string; label: string; description: string }
> = {
  canChat: {
    icon: '💬',
    label: 'Chat',
    description: 'Participate in conversations',
  },
  canTrade: {
    icon: '📈',
    label: 'Trade',
    description: 'Execute trades on DEXes',
  },
  canVote: {
    icon: '🗳️',
    label: 'Vote',
    description: 'Vote on governance proposals',
  },
  canPropose: {
    icon: '📝',
    label: 'Propose',
    description: 'Create governance proposals',
  },
  canStake: {
    icon: '🔒',
    label: 'Stake',
    description: 'Stake tokens in protocols',
  },
  a2a: {
    icon: '🤝',
    label: 'Agent-to-Agent',
    description: 'Communicate with other agents',
  },
  compute: {
    icon: '🧮',
    label: 'Compute',
    description: 'Access DWS compute resources',
  },
}

const TICK_INTERVALS = [
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute' },
  { value: 120000, label: '2 minutes' },
  { value: 300000, label: '5 minutes' },
  { value: 600000, label: '10 minutes' },
  { value: 1800000, label: '30 minutes' },
]

export default function CreateAgentPage() {
  const navigate = useNavigate()
  const {
    authenticated,
    loginWithWallet,
    loading: authLoading,
    walletAddress,
  } = useJejuAuth()

  // Step state: 1=Template, 2=Capabilities, 3=Autonomous, 4=Deploy
  const [step, setStep] = useState(1)

  // Character selection
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null,
  )

  // Agent config
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [initialFunding, setInitialFunding] = useState('')

  // Capabilities
  const [capabilities, setCapabilities] = useState<Capabilities>({
    canChat: true,
    canTrade: false,
    canVote: false,
    canPropose: false,
    canStake: false,
    a2a: false,
    compute: false,
  })

  // Autonomous settings
  const [autonomousSettings, setAutonomousSettings] =
    useState<AutonomousSettings>({
      enabled: false,
      tickIntervalMs: 60000,
    })

  const { data: characters, isLoading: loadingCharacters } = useCharacters()
  const { data: selectedCharacter } = useCharacter(selectedCharacterId ?? '')
  const registerAgent = useRegisterAgent()

  const handleCreate = async () => {
    if (!selectedCharacter) return

    if (!authenticated) {
      toast.error('Please connect your wallet first')
      return
    }

    try {
      const agentName = customName || selectedCharacter.name
      const result = await registerAgent.mutateAsync({
        name: agentName,
        character: {
          id: selectedCharacter.id,
          name: agentName,
          description: customDescription || selectedCharacter.description,
          system: selectedCharacter.system,
          bio: selectedCharacter.bio,
          messageExamples: [],
          topics: selectedCharacter.topics,
          adjectives: selectedCharacter.adjectives,
          style: selectedCharacter.style,
        },
        initialFunding: initialFunding
          ? (Number(initialFunding) * 1e18).toString()
          : undefined,
        capabilities,
        autonomous: autonomousSettings.enabled
          ? {
              enabled: true,
              tickIntervalMs: autonomousSettings.tickIntervalMs,
            }
          : undefined,
      })

      if (result.autonomousEnabled) {
        toast.success('Agent deployed with autonomous mode enabled')
      } else if (autonomousSettings.enabled) {
        toast.success(
          'Agent deployed (autonomous mode requires AUTONOMOUS_ENABLED=true on server)',
        )
      } else {
        toast.success('Agent deployed successfully')
      }
      navigate('/agents')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to deploy agent',
      )
    }
  }

  const canProceedFromStep = (s: number) => {
    if (s === 1) return selectedCharacterId !== null
    if (s === 2) return true // Capabilities are optional
    if (s === 3) return true // Autonomous is optional
    if (s === 4) return authenticated
    return false
  }

  const nextStep = () => {
    if (canProceedFromStep(step)) {
      setStep((s) => Math.min(s + 1, 4))
    }
  }

  const prevStep = () => {
    setStep((s) => Math.max(s - 1, 1))
  }

  if (loadingCharacters) {
    return (
      <output className="flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading templates
        </p>
      </output>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          to="/agents"
          className="text-sm flex items-center gap-1 hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Agents
        </Link>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <h1
          className="text-3xl md:text-4xl font-bold mb-2 font-display"
          style={{ color: 'var(--text-primary)' }}
        >
          Deploy Agent
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Create an autonomous AI agent on the Jeju Network
        </p>
      </header>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {[
          { num: 1, label: 'Template' },
          { num: 2, label: 'Capabilities' },
          { num: 3, label: 'Autonomous' },
          { num: 4, label: 'Deploy' },
        ].map(({ num, label }, i) => (
          <div key={num} className="flex items-center">
            <button
              type="button"
              onClick={() => num < step && setStep(num)}
              disabled={num > step}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                num === step
                  ? 'bg-[var(--color-primary)] text-white'
                  : num < step
                    ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/30'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
              }`}
            >
              <span className="font-bold">{num}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < 3 && (
              <div
                className="w-8 h-0.5 mx-1"
                style={{
                  backgroundColor:
                    num < step ? 'var(--color-primary)' : 'var(--border)',
                }}
                aria-hidden="true"
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Template Selection */}
      {step === 1 && (
        <section className="animate-fade-in" aria-labelledby="step1-heading">
          <h2
            id="step1-heading"
            className="text-lg font-bold mb-4 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Choose a Template
          </h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Select a pre-built character template as a starting point for your
            agent.
          </p>

          {characters && characters.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {characters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacterId(character.id)}
                  className={`card p-5 text-left transition-all ${
                    selectedCharacterId === character.id
                      ? 'ring-2 ring-[var(--color-primary)]'
                      : 'hover:ring-2 hover:ring-[var(--color-primary)]/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)' }}
                      aria-hidden="true"
                    >
                      🤖
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-bold truncate mb-1"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {character.name}
                      </p>
                      <p
                        className="text-sm line-clamp-2"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {character.description}
                      </p>
                    </div>
                    {selectedCharacterId === character.id && (
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="card-static p-8 text-center">
              <div className="text-5xl mb-4" aria-hidden="true">
                📭
              </div>
              <p style={{ color: 'var(--text-secondary)' }}>
                No character templates available. Please check that the API is
                running.
              </p>
            </div>
          )}

          <div className="flex justify-end mt-8">
            <button
              type="button"
              onClick={nextStep}
              disabled={!canProceedFromStep(1)}
              className="btn-primary"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Step 2: Capabilities */}
      {step === 2 && (
        <section className="animate-fade-in" aria-labelledby="step2-heading">
          <h2
            id="step2-heading"
            className="text-lg font-bold mb-4 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Configure Capabilities
          </h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Select the actions your agent can perform. You can always change
            these later.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {Object.entries(CAPABILITY_CONFIG).map(([key, config]) => {
              const capKey = key as keyof Capabilities
              const enabled = capabilities[capKey]

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setCapabilities((prev) => ({ ...prev, [capKey]: !enabled }))
                  }
                  className={`p-4 rounded-xl border text-left transition-all ${
                    enabled
                      ? 'ring-2 ring-[var(--color-primary)] border-[var(--color-primary)]'
                      : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                  }`}
                  style={{
                    backgroundColor: enabled
                      ? 'rgba(99, 102, 241, 0.1)'
                      : 'var(--surface)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{config.icon}</span>
                    <div className="flex-1">
                      <p
                        className="font-medium mb-0.5"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {config.label}
                      </p>
                      <p
                        className="text-sm"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {config.description}
                      </p>
                    </div>
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center text-xs ${
                        enabled
                          ? 'bg-[var(--color-primary)] text-white'
                          : 'bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      {enabled && '✓'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          <div className="flex justify-between mt-8">
            <button type="button" onClick={prevStep} className="btn-ghost">
              Back
            </button>
            <button type="button" onClick={nextStep} className="btn-primary">
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Step 3: Autonomous Settings */}
      {step === 3 && (
        <section className="animate-fade-in" aria-labelledby="step3-heading">
          <h2
            id="step3-heading"
            className="text-lg font-bold mb-4 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Autonomous Mode
          </h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Enable your agent to run automatically and make decisions on its
            own.
          </p>

          <div className="card-static p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p
                  className="font-medium mb-1"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Enable Autonomous Mode
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Agent will tick automatically and execute actions
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setAutonomousSettings((prev) => ({
                    ...prev,
                    enabled: !prev.enabled,
                  }))
                }
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  autonomousSettings.enabled
                    ? 'bg-[var(--color-primary)]'
                    : 'bg-[var(--bg-tertiary)]'
                }`}
                role="switch"
                aria-checked={autonomousSettings.enabled}
              >
                <span
                  className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                    autonomousSettings.enabled ? 'translate-x-7' : ''
                  }`}
                />
              </button>
            </div>

            {autonomousSettings.enabled && (
              <div
                className="pt-6 border-t"
                style={{ borderColor: 'var(--border)' }}
              >
                <label
                  htmlFor="tick-interval"
                  className="block text-sm font-medium mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Tick Interval
                </label>
                <select
                  id="tick-interval"
                  value={autonomousSettings.tickIntervalMs}
                  onChange={(e) =>
                    setAutonomousSettings((prev) => ({
                      ...prev,
                      tickIntervalMs: Number(e.target.value),
                    }))
                  }
                  className="input max-w-xs"
                >
                  {TICK_INTERVALS.map((interval) => (
                    <option key={interval.value} value={interval.value}>
                      {interval.label}
                    </option>
                  ))}
                </select>
                <p
                  className="text-xs mt-2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  How often the agent will wake up and check for actions to take
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-between mt-8">
            <button type="button" onClick={prevStep} className="btn-ghost">
              Back
            </button>
            <button type="button" onClick={nextStep} className="btn-primary">
              Continue
            </button>
          </div>
        </section>
      )}

      {/* Step 4: Deploy */}
      {step === 4 && (
        <section className="animate-fade-in" aria-labelledby="step4-heading">
          <h2
            id="step4-heading"
            className="text-lg font-bold mb-4 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Review & Deploy
          </h2>

          {/* Summary Card */}
          <div className="card-static p-6 mb-6">
            <div className="flex items-start gap-4 mb-6">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)' }}
              >
                🤖
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={selectedCharacter?.name}
                  className="text-xl font-bold font-display bg-transparent border-none outline-none w-full"
                  style={{ color: 'var(--text-primary)' }}
                />
                <textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder={selectedCharacter?.description}
                  className="w-full text-sm bg-transparent border-none outline-none resize-none mt-1"
                  style={{ color: 'var(--text-tertiary)' }}
                  rows={2}
                />
              </div>
            </div>

            {/* Capabilities Summary */}
            <div className="mb-6">
              <p
                className="text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Capabilities
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(capabilities)
                  .filter(([, enabled]) => enabled)
                  .map(([key]) => {
                    const config = CAPABILITY_CONFIG[key as keyof Capabilities]
                    return (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                        style={{
                          backgroundColor: 'rgba(99, 102, 241, 0.1)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        <span>{config.icon}</span>
                        {config.label}
                      </span>
                    )
                  })}
                {Object.values(capabilities).every((v) => !v) && (
                  <span
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    No capabilities selected
                  </span>
                )}
              </div>
            </div>

            {/* Autonomous Summary */}
            {autonomousSettings.enabled && (
              <div className="mb-6">
                <p
                  className="text-sm font-medium mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Autonomous Mode
                </p>
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs"
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    color: 'rgb(245, 158, 11)',
                  }}
                >
                  🔄 Every{' '}
                  {TICK_INTERVALS.find(
                    (t) => t.value === autonomousSettings.tickIntervalMs,
                  )?.label ?? '1 minute'}
                </span>
              </div>
            )}

            {/* Initial Funding */}
            <div>
              <label
                htmlFor="initial-funding"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Initial Vault Funding
                <span
                  className="ml-2 font-normal"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  (optional)
                </span>
              </label>
              <div className="flex items-center gap-2 max-w-xs">
                <input
                  id="initial-funding"
                  type="number"
                  step="0.01"
                  min="0"
                  value={initialFunding}
                  onChange={(e) => setInitialFunding(e.target.value)}
                  placeholder="0.0"
                  className="input flex-1"
                />
                <span
                  className="text-sm font-mono"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  ETH
                </span>
              </div>
            </div>
          </div>

          {/* Wallet Connection */}
          {!authenticated ? (
            <div className="card-static p-6 mb-6 text-center">
              <div className="text-4xl mb-4">🔐</div>
              <h3
                className="font-bold mb-2 font-display"
                style={{ color: 'var(--text-primary)' }}
              >
                Connect Wallet to Deploy
              </h3>
              <p
                className="mb-4 text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                You'll be the owner of this agent and control its vault.
              </p>
              <button
                type="button"
                onClick={loginWithWallet}
                disabled={authLoading}
                className="btn-primary"
              >
                {authLoading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Connecting...
                  </>
                ) : (
                  'Connect Wallet'
                )}
              </button>
            </div>
          ) : (
            <div
              className="p-4 rounded-xl mb-6"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-sm font-medium mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Owner
              </p>
              <p
                className="text-sm font-mono"
                style={{ color: 'var(--text-primary)' }}
              >
                {walletAddress}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between">
            <button type="button" onClick={prevStep} className="btn-ghost">
              Back
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!authenticated || registerAgent.isPending}
              className="btn-primary"
            >
              {registerAgent.isPending ? (
                <>
                  <LoadingSpinner size="sm" />
                  Deploying...
                </>
              ) : (
                'Deploy Agent'
              )}
            </button>
          </div>

          {/* Error */}
          {registerAgent.isError && (
            <div
              className="p-4 rounded-xl mt-4"
              style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
              role="alert"
            >
              <p
                className="text-sm font-medium"
                style={{ color: 'var(--color-error)' }}
              >
                {registerAgent.error.message}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
