import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChatInterface } from '../components/ChatInterface'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  type CharacterWithRuntime,
  type RoomType,
  useChatCharacters,
  useCreateRoom,
} from '../hooks'
import { ROOM_TYPE_CONFIG } from '../lib/constants'

const ROOM_TYPES = Object.entries(ROOM_TYPE_CONFIG).map(([type, config]) => ({
  type: type as RoomType,
  ...config,
}))

export default function ChatPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialCharacter = searchParams.get('character')

  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterWithRuntime | null>(null)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('collaboration')

  const { data: characters, isLoading } = useChatCharacters()
  const createRoom = useCreateRoom()

  useEffect(() => {
    if (characters && initialCharacter && !selectedCharacter) {
      const found = characters.find((c) => c.id === initialCharacter)
      if (found) setSelectedCharacter(found)
    }
  }, [characters, initialCharacter, selectedCharacter])

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomName.trim()) return

    const result = await createRoom.mutateAsync({
      name: roomName.trim(),
      roomType,
    })

    setShowCreateRoom(false)
    setRoomName('')
    navigate(`/chat/${result.roomId}`)
  }

  if (isLoading) {
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
        <button
          type="button"
          onClick={() => setShowCreateRoom(!showCreateRoom)}
          className={showCreateRoom ? 'btn-secondary' : 'btn-primary'}
          aria-expanded={showCreateRoom}
        >
          {showCreateRoom ? 'Cancel' : 'New Room'}
        </button>
      </header>

      {showCreateRoom && (
        <section className="card-static p-6 mb-8 animate-slide-up">
          <h2
            className="text-lg font-bold mb-5 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            New Room
          </h2>

          <form onSubmit={handleCreateRoom} className="space-y-5">
            <div>
              <label
                htmlFor="room-name"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Name
              </label>
              <input
                id="room-name"
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="input max-w-md"
                required
              />
            </div>

            <fieldset>
              <legend
                className="block text-sm font-medium mb-3"
                style={{ color: 'var(--text-secondary)' }}
              >
                Type
              </legend>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {ROOM_TYPES.map((rt) => (
                  <button
                    key={rt.type}
                    type="button"
                    onClick={() => setRoomType(rt.type)}
                    className={`p-4 rounded-xl border text-center transition-all ${
                      roomType === rt.type
                        ? 'ring-2 ring-[var(--color-primary)] border-[var(--color-primary)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)]'
                    }`}
                    style={{
                      backgroundColor:
                        roomType === rt.type
                          ? 'rgba(99, 102, 241, 0.1)'
                          : 'var(--surface)',
                    }}
                    aria-pressed={roomType === rt.type}
                  >
                    <div className="text-2xl mb-1" aria-hidden="true">
                      {rt.icon}
                    </div>
                    <p
                      className="font-medium text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {rt.label}
                    </p>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateRoom(false)}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!roomName.trim() || createRoom.isPending}
                className="btn-primary"
              >
                {createRoom.isPending ? <LoadingSpinner size="sm" /> : 'Create'}
              </button>
            </div>

            {createRoom.isError && (
              <div
                className="p-3 rounded-lg"
                style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
                role="alert"
              >
                <p className="text-sm" style={{ color: 'var(--color-error)' }}>
                  {createRoom.error.message}
                </p>
              </div>
            )}
          </form>
        </section>
      )}

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
              roomId={roomId}
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
