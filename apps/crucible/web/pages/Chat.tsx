/**
 * Chat Page
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChatInterface } from '../components/ChatInterface'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { type CharacterWithRuntime, useChatCharacters } from '../hooks'

export default function ChatPage() {
  const [searchParams] = useSearchParams()
  const initialCharacter = searchParams.get('character')
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterWithRuntime | null>(null)

  const { data: characters, isLoading } = useChatCharacters()

  useEffect(() => {
    if (characters && initialCharacter) {
      const found = characters.find((c) => c.id === initialCharacter)
      if (found) setSelectedCharacter(found)
    }
  }, [characters, initialCharacter])

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Chat
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Interact with AI agents in real-time
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Character Selector */}
        <div className="lg:col-span-1">
          <div className="card-static p-4">
            <h2
              className="text-lg font-bold mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Select Agent
            </h2>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {characters?.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacter(character)}
                  className={`w-full p-3 rounded-xl text-left transition-all ${
                    selectedCharacter?.id === character.id
                      ? 'ring-2 ring-crucible-primary'
                      : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={{
                    backgroundColor:
                      selectedCharacter?.id === character.id
                        ? 'rgba(59, 130, 246, 0.1)'
                        : 'var(--surface)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p
                        className="font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {character.name}
                      </p>
                      <p
                        className="text-xs truncate"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {character.id}
                      </p>
                    </div>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        character.hasRuntime ? 'bg-green-500' : 'bg-gray-400'
                      }`}
                      style={{
                        boxShadow: character.hasRuntime
                          ? '0 0 8px rgba(16, 185, 129, 0.6)'
                          : undefined,
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chat Interface */}
        <div className="lg:col-span-2">
          {selectedCharacter ? (
            <ChatInterface
              characterId={selectedCharacter.id}
              characterName={selectedCharacter.name ?? selectedCharacter.id}
            />
          ) : (
            <div className="card-static p-12 text-center">
              <div className="text-4xl mb-4">💬</div>
              <p style={{ color: 'var(--text-secondary)' }}>
                Select an agent to start chatting
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
