/**
 * Rooms Page
 */

import { useState } from 'react'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { type RoomType, useCreateRoom } from '../hooks'

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
    description: 'Agents work together on a shared goal',
  },
  {
    type: 'adversarial',
    label: 'Adversarial',
    icon: '⚔️',
    description: 'Red team vs Blue team security scenarios',
  },
  {
    type: 'debate',
    label: 'Debate',
    icon: '💬',
    description: 'Agents debate and discuss topics',
  },
  {
    type: 'council',
    label: 'Council',
    icon: '🏛️',
    description: 'Multi-agent decision making',
  },
]

export default function RoomsPage() {
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('collaboration')

  const createRoom = useCreateRoom()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    const result = await createRoom.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
      roomType,
    })

    // Navigate to the new room
    window.location.href = `/rooms/${result.roomId}`
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Rooms
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Coordinate multi-agent interactions
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="btn-primary"
        >
          + Create Room
        </button>
      </div>

      {/* Create Room Form */}
      {showCreate && (
        <div className="card-static p-6 mb-8">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Create New Room
          </h2>

          <form onSubmit={handleCreate} className="space-y-4">
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
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the room's purpose..."
                className="input min-h-[100px] resize-none"
              />
            </div>

            <fieldset>
              <legend
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Room Type
              </legend>
              <div className="grid grid-cols-2 gap-3">
                {ROOM_TYPES.map((rt) => (
                  <button
                    key={rt.type}
                    type="button"
                    onClick={() => setRoomType(rt.type)}
                    className={`p-4 rounded-xl border text-left transition-all ${
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
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{rt.icon}</span>
                      <span
                        className="font-medium"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {rt.label}
                      </span>
                    </div>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {rt.description}
                    </p>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || createRoom.isPending}
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

      {/* Room Types Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ROOM_TYPES.map((rt) => (
          <div key={rt.type} className="card p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">{rt.icon}</div>
              <div>
                <h3
                  className="font-bold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {rt.label}
                </h3>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {rt.description}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setRoomType(rt.type)
                setShowCreate(true)
              }}
              className="btn-secondary btn-sm w-full"
            >
              Create {rt.label} Room
            </button>
          </div>
        ))}
      </div>

      {/* Placeholder for room list */}
      <div className="mt-8 card-static p-12 text-center">
        <div className="text-4xl mb-4">🏛️</div>
        <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>
          Room list coming soon
        </p>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Create a room above to get started
        </p>
      </div>
    </div>
  )
}
