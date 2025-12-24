/**
 * Create Agent Page
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CharacterCard } from '../components/CharacterCard'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useCharacter, useCharacters, useRegisterAgent } from '../hooks'

export default function CreateAgentPage() {
  const navigate = useNavigate()
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null,
  )
  const [initialFunding, setInitialFunding] = useState('')

  const { data: characters, isLoading: loadingCharacters } = useCharacters()
  const { data: selectedCharacter } = useCharacter(selectedCharacterId ?? '')
  const registerAgent = useRegisterAgent()

  const handleCreate = async () => {
    if (!selectedCharacter) return

    await registerAgent.mutateAsync({
      character: {
        id: selectedCharacter.id,
        name: selectedCharacter.name,
        description: selectedCharacter.description,
        system: selectedCharacter.system,
        bio: selectedCharacter.bio,
        messageExamples: [], // Simplified for creation
        topics: selectedCharacter.topics,
        adjectives: selectedCharacter.adjectives,
        style: selectedCharacter.style,
      },
      initialFunding: initialFunding
        ? (Number(initialFunding) * 1e18).toString()
        : undefined,
    })

    navigate('/agents')
  }

  if (loadingCharacters) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Create Agent
      </h1>
      <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>
        Select a character template and deploy a new agent
      </p>

      {/* Step 1: Select Character */}
      <div className="mb-8">
        <h2
          className="text-lg font-bold mb-4 flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span className="w-6 h-6 rounded-full bg-crucible-primary flex items-center justify-center text-sm text-white">
            1
          </span>
          Select Character
        </h2>

        {selectedCharacterId ? (
          <div className="card-static p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-2xl">🤖</div>
                <div>
                  <p
                    className="font-bold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {selectedCharacter?.name}
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {selectedCharacter?.description}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCharacterId(null)}
                className="btn-ghost btn-sm"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {characters?.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                onSelect={setSelectedCharacterId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Configure */}
      {selectedCharacterId && (
        <div className="mb-8">
          <h2
            className="text-lg font-bold mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="w-6 h-6 rounded-full bg-crucible-primary flex items-center justify-center text-sm text-white">
              2
            </span>
            Configure
          </h2>

          <div className="card-static p-6 space-y-4">
            <div>
              <label
                htmlFor="initial-funding"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Initial Funding (ETH) - Optional
              </label>
              <input
                id="initial-funding"
                type="number"
                step="0.01"
                min="0"
                value={initialFunding}
                onChange={(e) => setInitialFunding(e.target.value)}
                placeholder="0.1"
                className="input"
              />
              <p
                className="text-xs mt-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Fund the agent's vault to enable on-chain operations
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Deploy */}
      {selectedCharacterId && (
        <div className="mb-8">
          <h2
            className="text-lg font-bold mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span className="w-6 h-6 rounded-full bg-crucible-primary flex items-center justify-center text-sm text-white">
              3
            </span>
            Deploy
          </h2>

          <div className="card-static p-6">
            <div className="flex items-center justify-between">
              <div>
                <p
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Ready to deploy {selectedCharacter?.name}
                </p>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  This will register the agent on-chain
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={registerAgent.isPending}
                className="btn-primary"
              >
                {registerAgent.isPending ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner size="sm" />
                    Deploying...
                  </span>
                ) : (
                  'Deploy Agent'
                )}
              </button>
            </div>
            {registerAgent.isError && (
              <p
                className="mt-4 text-sm"
                style={{ color: 'var(--color-error)' }}
              >
                {registerAgent.error.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
