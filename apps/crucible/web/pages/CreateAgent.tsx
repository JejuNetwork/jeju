import { useJejuAuth } from '@jejunetwork/auth/react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useCharacter, useCharacters, useRegisterAgent } from '../hooks'

export default function CreateAgentPage() {
  const navigate = useNavigate()
  const {
    authenticated,
    loginWithWallet,
    loading: authLoading,
    walletAddress,
  } = useJejuAuth()
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null,
  )
  const [initialFunding, setInitialFunding] = useState('')
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')

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
      await registerAgent.mutateAsync({
        character: {
          id: selectedCharacter.id,
          name: customName || selectedCharacter.name,
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
      })

      toast.success('Agent deployed successfully')
      navigate('/agents')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to deploy agent',
      )
    }
  }

  const currentStep = !authenticated ? 0 : selectedCharacterId ? 2 : 1
  const canDeploy =
    authenticated && selectedCharacter && !registerAgent.isPending

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

      {/* Progress Indicator */}
      <div className="flex items-center gap-4 mb-8">
        <StepIndicator step={1} currentStep={currentStep} label="Connect" />
        <div
          className="flex-1 h-0.5 rounded-full"
          style={{
            backgroundColor:
              currentStep >= 1 ? 'var(--color-primary)' : 'var(--border)',
          }}
          aria-hidden="true"
        />
        <StepIndicator step={2} currentStep={currentStep} label="Character" />
        <div
          className="flex-1 h-0.5 rounded-full"
          style={{
            backgroundColor:
              currentStep >= 2 ? 'var(--color-primary)' : 'var(--border)',
          }}
          aria-hidden="true"
        />
        <StepIndicator step={3} currentStep={currentStep} label="Deploy" />
      </div>

      {/* Step 0: Connect Wallet */}
      {!authenticated && (
        <section
          className="mb-8 animate-fade-in"
          aria-labelledby="step0-heading"
        >
          <h2
            id="step0-heading"
            className="text-lg font-bold mb-4 font-display flex items-center gap-3"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="step-circle" aria-hidden="true">
              1
            </span>
            Connect Wallet
          </h2>

          <div className="card-static p-8 text-center">
            <div className="text-5xl mb-4" aria-hidden="true">
              🔐
            </div>
            <h3
              className="text-xl font-bold mb-2 font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              Connect to Deploy
            </h3>
            <p
              className="mb-6 max-w-md mx-auto"
              style={{ color: 'var(--text-secondary)' }}
            >
              Connect your wallet to deploy and manage AI agents on the Jeju
              Network. Your wallet will be the owner of any agents you create.
            </p>
            <button
              type="button"
              onClick={loginWithWallet}
              disabled={authLoading}
              className="btn-primary btn-lg"
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
        </section>
      )}

      {/* Step 1: Select Character Template */}
      {authenticated && (
        <section
          className="mb-8 animate-fade-in"
          aria-labelledby="step1-heading"
        >
          <h2
            id="step1-heading"
            className="text-lg font-bold mb-4 font-display flex items-center gap-3"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="step-circle" aria-hidden="true">
              2
            </span>
            Choose Character Template
          </h2>

          {selectedCharacterId ? (
            <div className="card-static p-5 animate-bounce-in">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="text-3xl flex-shrink-0" aria-hidden="true">
                    🤖
                  </div>
                  <div className="min-w-0">
                    <p
                      className="font-bold truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {selectedCharacter?.name}
                    </p>
                    <p
                      className="text-sm truncate"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {selectedCharacter?.description}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCharacterId(null)}
                  className="btn-ghost btn-sm flex-shrink-0"
                >
                  Change
                </button>
              </div>
            </div>
          ) : characters && characters.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
              {characters.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacterId(character.id)}
                  className="card p-5 text-left transition-all hover:ring-2 hover:ring-[var(--color-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <div className="flex items-start gap-3">
                    <div className="text-3xl flex-shrink-0" aria-hidden="true">
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
        </section>
      )}

      {/* Step 2: Configure & Deploy */}
      {authenticated && selectedCharacterId && (
        <section className="animate-slide-up" aria-labelledby="step2-heading">
          <h2
            id="step2-heading"
            className="text-lg font-bold mb-4 font-display flex items-center gap-3"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="step-circle" aria-hidden="true">
              3
            </span>
            Configure & Deploy
          </h2>

          <div className="card-static p-6 space-y-6">
            {/* Custom Name */}
            <div>
              <label
                htmlFor="agent-name"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Agent Name
                <span
                  className="ml-2 font-normal"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  (optional, uses template name if empty)
                </span>
              </label>
              <input
                id="agent-name"
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={selectedCharacter?.name}
                className="input max-w-md"
              />
            </div>

            {/* Custom Description */}
            <div>
              <label
                htmlFor="agent-description"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Description
                <span
                  className="ml-2 font-normal"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  (optional)
                </span>
              </label>
              <textarea
                id="agent-description"
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder={selectedCharacter?.description}
                className="input max-w-md min-h-[80px] resize-y"
                rows={3}
              />
            </div>

            {/* Initial Funding */}
            <div>
              <label
                htmlFor="initial-funding"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Initial Funding
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
                  aria-describedby="funding-hint"
                />
                <span
                  className="text-sm font-mono"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  ETH
                </span>
              </div>
              <p
                id="funding-hint"
                className="text-xs mt-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Fund your agent's vault to enable on-chain actions
              </p>
            </div>

            {/* Owner Info */}
            <div
              className="p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p
                className="text-sm font-medium mb-1"
                style={{ color: 'var(--text-secondary)' }}
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

            {/* Deploy Button */}
            <div
              className="pt-4 border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {customName || selectedCharacter?.name}
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Ready to deploy
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!canDeploy}
                className="btn-primary w-full sm:w-auto"
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

            {/* Error Message */}
            {registerAgent.isError && (
              <div
                className="p-4 rounded-xl"
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
          </div>
        </section>
      )}
    </div>
  )
}

interface StepIndicatorProps {
  step: number
  currentStep: number
  label: string
}

function StepIndicator({ step, currentStep, label }: StepIndicatorProps) {
  const isActive = step <= currentStep
  const isCurrent = step === currentStep

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
          isActive
            ? 'bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-violet)] text-white'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
        }`}
        aria-hidden="true"
      >
        {step}
      </div>
      <span
        className={`text-sm font-medium hidden sm:block ${
          isCurrent
            ? 'text-[var(--text-primary)]'
            : 'text-[var(--text-tertiary)]'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
