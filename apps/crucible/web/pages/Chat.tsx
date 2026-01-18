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

  const { data: characters, isLoading: isLoadingCharacters } =
    useChatCharacters()

  // Handle initial character from URL param
  useEffect(() => {
    if (characters && initialCharacter && !selectedCharacter) {
      const found = characters.find((c) => c.id === initialCharacter)
      if (found) setSelectedCharacter(found)
    }
  }, [characters, initialCharacter, selectedCharacter])

  if (isLoadingCharacters) {
    return (
      <output className="flex flex-col items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </output>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1
          className="text-3xl md:text-4xl font-bold font-display"
          style={{ color: 'var(--text-primary)' }}
        >
          Chat
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-4 xl:col-span-3">
          <div className="card-static p-4 lg:sticky lg:top-24">
            <h2
              className="text-base font-bold mb-4 font-display"
              style={{ color: 'var(--text-primary)' }}
            >
              Agents
            </h2>
            <div
              className="space-y-2 max-h-[300px] lg:max-h-[calc(100vh-280px)] overflow-y-auto scrollbar-hide"
              role="listbox"
            >
              {characters?.length === 0 && (
                <p
                  className="text-sm p-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  No agents
                </p>
              )}
              {characters?.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => setSelectedCharacter(character)}
                  className={`w-full p-3 rounded-xl text-left transition-all ${
                    selectedCharacter?.id === character.id
                      ? 'ring-2 ring-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={{
                    backgroundColor:
                      selectedCharacter?.id === character.id
                        ? undefined
                        : 'var(--surface)',
                  }}
                  role="option"
                  aria-selected={selectedCharacter?.id === character.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p
                      className="font-medium truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {character.name}
                    </p>
                    <div
                      className={`flex-shrink-0 ${
                        character.hasRuntime
                          ? 'status-dot-active'
                          : 'status-dot-inactive'
                      }`}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="lg:col-span-8 xl:col-span-9">
          {selectedCharacter ? (
            <ChatInterface
              characterId={selectedCharacter.id}
              characterName={selectedCharacter.name ?? selectedCharacter.id}
            />
          ) : (
            <div className="card-static p-12 text-center min-h-[400px] flex flex-col items-center justify-center">
              <div className="text-5xl mb-4" aria-hidden="true">
                💬
              </div>
              <p style={{ color: 'var(--text-secondary)' }}>Select an agent</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
