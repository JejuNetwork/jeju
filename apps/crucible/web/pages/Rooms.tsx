import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  type RoomSearchFilters,
  type RoomType,
  useCreateRoom,
  useRooms,
} from '../hooks'
import { ROOM_TYPE_CONFIG } from '../lib/constants'

const ROOM_TYPES = Object.entries(ROOM_TYPE_CONFIG).map(([type, config]) => ({
  type: type as RoomType,
  ...config,
}))

export default function RoomsPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<RoomSearchFilters>({})
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomDescription, setRoomDescription] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('collaboration')

  const { data, isLoading, error, fetchNextPage, isFetchingNextPage } =
    useRooms(filters)
  const createRoom = useCreateRoom()

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
    navigate(`/rooms/${result.roomId}`)
  }

  const handleFilterType = (type: RoomType | undefined) => {
    setFilters((prev) => ({ ...prev, roomType: type }))
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1
            className="text-3xl md:text-4xl font-bold mb-2 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Rooms
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Multi-agent collaboration spaces
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateRoom(!showCreateRoom)}
          className={showCreateRoom ? 'btn-secondary' : 'btn-primary'}
        >
          {showCreateRoom ? 'Cancel' : 'Create Room'}
        </button>
      </header>

      {/* Create Room Form */}
      {showCreateRoom && (
        <section className="card-static p-6 mb-8 animate-slide-up">
          <h2
            className="text-lg font-bold mb-5 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            Create New Room
          </h2>

          <form onSubmit={handleCreateRoom} className="space-y-5">
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
                className="input max-w-md"
                placeholder="Security Challenge #1"
                required
              />
            </div>

            <div>
              <label
                htmlFor="room-description"
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                Description
              </label>
              <textarea
                id="room-description"
                value={roomDescription}
                onChange={(e) => setRoomDescription(e.target.value)}
                className="input max-w-md min-h-[80px] resize-y"
                placeholder="Describe the purpose of this room..."
                rows={3}
              />
            </div>

            <fieldset>
              <legend
                className="block text-sm font-medium mb-3"
                style={{ color: 'var(--text-secondary)' }}
              >
                Room Type
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
                      className="font-medium text-sm mb-1"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {rt.label}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {rt.type === 'collaboration' &&
                        'Shared goals, no scoring'}
                      {rt.type === 'adversarial' && 'Red vs Blue team battles'}
                      {rt.type === 'debate' && 'Turn-based argumentation'}
                      {rt.type === 'board' && 'Proposals and voting'}
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
                {createRoom.isPending ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  'Create Room'
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

      {/* Filters */}
      <fieldset
        className="flex flex-wrap items-center gap-4 mb-8 p-4 rounded-xl border-0"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        aria-label="Filter rooms"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleFilterType(undefined)}
            className={`btn-sm ${!filters.roomType ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={!filters.roomType}
          >
            All
          </button>
          {ROOM_TYPES.map((rt) => (
            <button
              key={rt.type}
              type="button"
              onClick={() => handleFilterType(rt.type)}
              className={`btn-sm ${filters.roomType === rt.type ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={filters.roomType === rt.type}
            >
              <span aria-hidden="true">{rt.icon}</span>
              <span className="hidden sm:inline ml-1">{rt.label}</span>
            </button>
          ))}
        </div>
        {data && (
          <span
            className="text-sm ml-auto"
            style={{ color: 'var(--text-tertiary)' }}
            aria-live="polite"
          >
            {data.total} room{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </fieldset>

      {/* Loading State */}
      {isLoading && (
        <output className="flex flex-col items-center justify-center py-20">
          <LoadingSpinner size="lg" />
          <p className="mt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Loading rooms
          </p>
        </output>
      )}

      {/* Error State */}
      {error && (
        <div
          className="card-static p-8 text-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-5xl mb-4" role="img" aria-label="Error">
            ⚠️
          </div>
          <h2
            className="text-xl font-bold mb-2"
            style={{ color: 'var(--color-error)' }}
          >
            Failed to load rooms
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary mt-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {data && data.rooms.length === 0 && (
        <div className="card-static p-12 text-center">
          <div
            className="text-6xl mb-6 animate-float"
            role="img"
            aria-label="Room"
          >
            🏠
          </div>
          <h2
            className="text-2xl font-bold mb-3 font-display"
            style={{ color: 'var(--text-primary)' }}
          >
            {filters.roomType ? `No ${filters.roomType} rooms` : 'No rooms yet'}
          </h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Create the first room to start collaborating with agents.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowCreateRoom(true)}
              className="btn-primary"
            >
              Create Room
            </button>
            {filters.roomType && (
              <button
                type="button"
                onClick={() => handleFilterType(undefined)}
                className="btn-secondary"
              >
                Show All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Room Grid */}
      {data && data.rooms.length > 0 && (
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children list-none"
          aria-label="Room list"
        >
          {data.rooms.map((room) => (
            <li key={room.roomId}>
              <RoomCard room={room} />
            </li>
          ))}
        </ul>
      )}

      {/* Load More */}
      {data?.hasMore && (
        <div className="text-center mt-10">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="btn-secondary"
          >
            {isFetchingNextPage ? <LoadingSpinner size="sm" /> : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}

interface RoomCardProps {
  room: {
    roomId: string
    name: string
    description: string
    roomType: RoomType
    members: { agentId: string; role: string }[]
    active: boolean
    createdAt: number
    source?: 'onchain' | 'offchain'
  }
}

function RoomCard({ room }: RoomCardProps) {
  const typeConfig = ROOM_TYPE_CONFIG[room.roomType]

  return (
    <Link
      to={`/rooms/${room.roomId}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-2xl"
      aria-label={`Join ${room.name}`}
    >
      <article className="card p-6 h-full">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="text-3xl flex-shrink-0" role="img" aria-hidden="true">
            {typeConfig.icon}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className="badge"
              style={{
                backgroundColor: `${typeConfig.color}20`,
                color: typeConfig.color,
              }}
            >
              {typeConfig.label}
            </span>
            <div className="flex gap-2">
              {room.source === 'offchain' && (
                <span
                  className="badge badge-ghost text-xs"
                  title="Off-chain room"
                >
                  Local
                </span>
              )}
              <span className={room.active ? 'badge-success' : 'badge-error'}>
                <span
                  className="w-1.5 h-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                {room.active ? 'Active' : 'Ended'}
              </span>
            </div>
          </div>
        </div>

        {/* Name & Description */}
        <h3
          className="text-lg font-bold mb-2 font-display truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {room.name}
        </h3>
        {room.description && (
          <p
            className="text-sm line-clamp-2 mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            {room.description}
          </p>
        )}

        {/* Stats */}
        <dl
          className="flex items-center gap-4 text-sm"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <div className="flex items-center gap-1">
            <span aria-hidden="true">👥</span>
            <dd className="font-medium">{room.members.length}</dd>
            <dt className="sr-only">members</dt>
          </div>
          <div className="flex items-center gap-1">
            <span aria-hidden="true">⏱️</span>
            <dd className="font-medium">
              {new Date(room.createdAt).toLocaleDateString()}
            </dd>
            <dt className="sr-only">created</dt>
          </div>
        </dl>

        {/* Members Preview */}
        {room.members.length > 0 && (
          <div
            className="mt-4 pt-4 border-t flex items-center gap-2"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Members
            </span>
            <div className="flex -space-x-2">
              {room.members.slice(0, 5).map((member, i) => (
                <div
                  key={member.agentId}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: `hsl(${(parseInt(member.agentId, 10) * 137) % 360}, 70%, 50%)`,
                    color: 'white',
                    border: '2px solid var(--surface)',
                    zIndex: 5 - i,
                  }}
                  title={`Agent ${member.agentId} (${member.role})`}
                >
                  {member.role[0].toUpperCase()}
                </div>
              ))}
              {room.members.length > 5 && (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '2px solid var(--surface)',
                  }}
                >
                  +{room.members.length - 5}
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    </Link>
  )
}
