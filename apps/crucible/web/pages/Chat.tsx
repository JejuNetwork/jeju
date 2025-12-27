/**
 * Chat Page
 *
 * Chat with agents and manage collaboration rooms
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChatInterface } from '../components/ChatInterface'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  type CharacterWithRuntime,
  type RoomType,
  useChatCharacters,
  useCreateRoom,
} from '../hooks'
import { getRoomTypeConfig, ROOM_TYPE_CONFIG } from '../lib/constants'

const ROOM_TYPES = Object.entries(ROOM_TYPE_CONFIG).map(([type, config]) => ({
  type: type as RoomType,
  ...config,
}))

export default function ChatPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialCharacter = searchParams.get('character')

  const [selectedCharacter, setSelectedCharacter] = useState<CharacterWithRuntime | null>(null)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomDescription, setRoomDescription] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('collaboration')

  const { data: characters, isLoading } = useChatCharacters()
  const createRoom = useCreateRoom()

  // Set initial character from URL param
  useEffect(() => {
    if (characters && initialCharacter && !selectedCharacter) {
      const found = characters.find((c) => c.id === initialCharacter)
      if (found) setSelectedCharacter(found)
    }
  }, [characters, initialCharacter, selectedCharacter])

  // Memoized room type info
  const selectedRoomInfo = useMemo(() => getRoomTypeConfig(roomType), [roomType])

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomName.trim()) return

    const result = await createRoom.mutateAsync({
      name: roomName.trim(),
      description: roomDescription.trim() || undefined,
      roomType,
    })

    setShowCreateRoom(false)
    setRoomName('')
    setRoomDescription('')
    navigate(`/chat/${result.roomId}`)
  }

  const handleSelectCharacter = (character: CharacterWithRuntime) => {
    setSelectedCharacter(character)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20" role="status">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Loading agents
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-3xl md:text-4xl font-bold mb-2 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Chat
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {roomId ? `Room: ${roomId}` : 'Send messages to agents'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateRoom(!showCreateRoom)}
          className={showCreateRoom ? 'btn-secondary' : 'btn-primary'}
          aria-expanded={showCreateRoom}
        >
          {showCreateRoom ? 'Cancel' : 'New Room'}
        </button>
      </header>

      {/* Create Room Panel */}
      {showCreateRoom && (
        <section
          className="card-static p-6 mb-8 animate-slide-up"
          aria-labelledby="create-room-heading"
        >
          <h2
            id="create-room-heading"
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
                placeholder="Security Review"
                className="input max-w-md"
                required
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="room-description"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Description
                <span className="ml-2 font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  (optional)
                </span>
              </label>
              <textarea
                id="room-description"
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                placeholder="What is this room for?"
                className="input min-h-[80px] max-w-lg resize-none"
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
                    className={`p-4 rounded-xl border text-left transition-all ${
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
                    <div className="text-2xl mb-2" aria-hidden="true">
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
              <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
                {selectedRoomInfo.description}
              </p>
            </fieldset>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateRoom(false)}
                className="btn-ghost order-2 sm:order-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!roomName.trim() || createRoom.isPending}
                className="btn-primary order-1 sm:order-2"
              >
                {createRoom.isPending ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Creating
                  </>
                ) : (
                  'Create'
                )}
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

      {/* Main Chat Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Agent Selector - Sidebar */}
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
              aria-label="Available agents"
            >
              {characters?.length === 0 && (
                <p className="text-sm p-3" style={{ color: 'var(--text-tertiary)' }}>
                  No agents available
                </p>
              )}
              {characters?.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => handleSelectCharacter(character)}
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
                    <div className="min-w-0 flex-1">
                      <p
                        className="font-medium truncate"
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
                      className={`flex-shrink-0 ${
                        character.hasRuntime ? 'status-dot-active' : 'status-dot-inactive'
                      }`}
                      title={character.hasRuntime ? 'Online' : 'Offline'}
                      aria-label={character.hasRuntime ? 'Online' : 'Offline'}
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Chat Interface - Main Area */}
        <main className="lg:col-span-8 xl:col-span-9">
          {selectedCharacter ? (
            <ChatInterface
              characterId={selectedCharacter.id}
              characterName={selectedCharacter.name ?? selectedCharacter.id}
              roomId={roomId}
            />
          ) : (
            <div className="card-static p-12 text-center min-h-[400px] flex flex-col items-center justify-center">
              <div className="text-5xl mb-4 animate-float" aria-hidden="true">
                💬
              </div>
              <h3
                className="text-xl font-bold mb-2 font-display"
                style={{ color: 'var(--text-primary)' }}
              >
                Select an agent
              </h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                Choose from the sidebar to start
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
