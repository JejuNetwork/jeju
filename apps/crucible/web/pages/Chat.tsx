/**
 * Chat Page
 *
 * Chat with agents and manage rooms
 */

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

const ROOM_TYPES: {
  type: RoomType
  label: string
  icon: string
  description: string
}[] = [
  {
    type: 'collaboration',
    label: 'Collaboration',
    icon: '🤝',
    description: 'Agents work together',
  },
  {
    type: 'adversarial',
    label: 'Adversarial',
    icon: '⚔️',
    description: 'Red vs Blue team',
  },
  {
    type: 'debate',
    label: 'Debate',
    icon: '💬',
    description: 'Discussion & debate',
  },
  {
    type: 'council',
    label: 'Council',
    icon: '🏛️',
    description: 'Multi-agent decisions',
  },
]

export default function ChatPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialCharacter = searchParams.get('character')

  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterWithRuntime | null>(null)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomDescription, setRoomDescription] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('collaboration')

  const { data: characters, isLoading } = useChatCharacters()
  const createRoom = useCreateRoom()

  useEffect(() => {
    if (characters && initialCharacter) {
      const found = characters.find((c) => c.id === initialCharacter)
      if (found) setSelectedCharacter(found)
    }
  }, [characters, initialCharacter])

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

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Chat
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {roomId
              ? `Room: ${roomId}`
              : 'Interact with AI agents in real-time'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateRoom(!showCreateRoom)}
          className="btn-primary"
        >
          + New Room
        </button>
      </div>

      {/* Create Room Panel */}
      {showCreateRoom && (
        <div className="card-static p-6 mb-8">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Create New Room
          </h2>

          <form onSubmit={handleCreateRoom} className="space-y-4">
            <div>
              <label
                htmlFor="room-name"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Room Name
              </label>
              <input
                id="room-name"
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Security Challenge"
                className="input"
                required
              />
            </div>

            <div>
              <label
                htmlFor="room-description"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Description (optional)
              </label>
              <textarea
                id="room-description"
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                placeholder="Describe the room's purpose..."
                className="input min-h-[80px] resize-none"
              />
            </div>

            <fieldset>
              <legend
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Room Type
              </legend>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {ROOM_TYPES.map((rt) => (
                  <button
                    key={rt.type}
                    type="button"
                    onClick={() => setRoomType(rt.type)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      roomType === rt.type ? 'ring-2 ring-crucible-primary' : ''
                    }`}
                    style={{
                      backgroundColor:
                        roomType === rt.type
                          ? 'rgba(59, 130, 246, 0.1)'
                          : 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{rt.icon}</span>
                      <span
                        className="font-medium text-sm"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {rt.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateRoom(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!roomName.trim() || createRoom.isPending}
                className="btn-primary flex-1"
              >
                {createRoom.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <LoadingSpinner size="sm" />
                    Creating...
                  </span>
                ) : (
                  'Create Room'
                )}
              </button>
            </div>

            {createRoom.isError && (
              <p className="text-sm" style={{ color: 'var(--color-error)' }}>
                {createRoom.error.message}
              </p>
            )}
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent Selector */}
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
              roomId={roomId}
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
